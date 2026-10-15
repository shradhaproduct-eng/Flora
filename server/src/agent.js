import Anthropic from "@anthropic-ai/sdk";
import { pool } from "./db.js";
import { readSettings } from "./routes/settings.js";

// The arrangement assistant: a Claude tool-use loop over read-only views of
// the catalog, settings and saved arrangements. It never writes to the
// database itself — its output is a proposed arrangement that the user
// loads into the builder and saves (or tweaks) by hand.

const MODEL = "claude-opus-5-5";
const MAX_TOOL_ROUNDS = 12;

const SYSTEM_PROMPT = `You are Flora's arrangement assistant, helping a florist design flower arrangements that hit their price and profit targets.

How pricing works in Flora:
- stems cost = sum of (stem price × stems) for each flower
- total cost = stems cost + materials & extras cost
- selling price = total cost × markup multiplier
- profit = selling price − total cost
All prices are in UAE dirhams (AED); always quote amounts in AED. A few catalog items are priced per bunch rather than per stem — their names say so.

Work from real data: check the flower catalog and the global defaults before proposing anything, and only use flowers that are in the catalog. Use price_arrangement to check the numbers of a candidate mix rather than doing the arithmetic yourself, and adjust stems or swap flowers until the request's constraints are met. Use the global default materials cost and markup multiplier unless the user asks otherwise or a target can't be met without changing them — say so if you change them.

When you have a good arrangement, call propose_arrangement exactly once with the final version; the user will see it as a card they can open in the builder and save. Then reply briefly: what you chose and why, and how it lands against their targets. If a target is impossible with the current catalog, say what's achievable instead. If the request is ambiguous, make a sensible assumption and mention it rather than asking a string of questions.`;

const itemsSchema = {
  type: "array",
  description: "Flowers in the arrangement.",
  items: {
    type: "object",
    properties: {
      flower_name: { type: "string", description: "Exact catalog name of the flower." },
      stems: { type: "integer", minimum: 1, description: "Number of stems." },
    },
    required: ["flower_name", "stems"],
    additionalProperties: false,
  },
};

const pricingProperties = {
  items: itemsSchema,
  materials_cost: {
    type: "number",
    minimum: 0,
    description: "Materials & extras cost in AED. Omit to use the global default.",
  },
  markup_multiplier: {
    type: "number",
    minimum: 0,
    description: "Markup multiplier. Omit to use the global default.",
  },
};

export const TOOLS = [
  {
    name: "list_flowers",
    description: "List every flower in the catalog with its price per stem in AED.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_settings",
    description:
      "Get the global defaults every new arrangement starts from: materials & extras cost (AED) and markup multiplier.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_saved_arrangements",
    description:
      "List the user's saved arrangements (most recent first) with their flowers, stem counts and totals. Use when the user refers to an existing arrangement.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "price_arrangement",
    description:
      "Price a candidate arrangement using current catalog prices. Returns each line's cost plus stems cost, total cost, selling price and profit. Errors if a flower isn't in the catalog.",
    input_schema: {
      type: "object",
      properties: pricingProperties,
      required: ["items"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_arrangement",
    description:
      "Present the final arrangement to the user as a card they can open in the builder. Call once, with the version you recommend.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short, friendly arrangement name." },
        ...pricingProperties,
      },
      required: ["name", "items"],
      additionalProperties: false,
    },
  },
];

async function getCatalog() {
  const { rows } = await pool.query("SELECT id, name, stem_price FROM flowers ORDER BY name ASC");
  return rows;
}

// Prices items against the live catalog, matching names case-insensitively.
// Throws (surfaced to Claude as an is_error tool result) on bad input so it
// can correct itself.
async function priceArrangement(input) {
  const items = Array.isArray(input?.items) ? input.items : [];
  if (items.length === 0) throw new Error("items must contain at least one flower.");

  const [catalog, settings] = await Promise.all([getCatalog(), readSettings()]);
  const byName = new Map(catalog.map((f) => [f.name.toLowerCase(), f]));

  const lines = items.map((item) => {
    const flower = byName.get(String(item.flower_name ?? "").trim().toLowerCase());
    if (!flower) {
      throw new Error(
        `"${item.flower_name}" is not in the catalog. Available: ${catalog.map((f) => f.name).join(", ")}.`
      );
    }
    const stems = Number(item.stems);
    if (!Number.isInteger(stems) || stems < 1) {
      throw new Error(`stems for ${flower.name} must be a whole number of at least 1.`);
    }
    return {
      flower_id: flower.id,
      flower_name: flower.name,
      stem_price: flower.stem_price,
      stems,
      line_total: round(flower.stem_price * stems),
    };
  });

  const materials_cost = numberOr(input.materials_cost, settings.default_materials_cost);
  const markup_multiplier = numberOr(input.markup_multiplier, settings.default_markup_multiplier);
  if (materials_cost < 0 || markup_multiplier < 0) {
    throw new Error("materials_cost and markup_multiplier must be non-negative.");
  }

  const stems_cost = lines.reduce((sum, line) => sum + line.stem_price * line.stems, 0);
  const total_cost = stems_cost + materials_cost;
  const selling_price = total_cost * markup_multiplier;
  return {
    items: lines,
    total_stems: lines.reduce((sum, line) => sum + line.stems, 0),
    materials_cost,
    markup_multiplier,
    stems_cost: round(stems_cost),
    total_cost: round(total_cost),
    selling_price: round(selling_price),
    profit: round(selling_price - total_cost),
  };
}

async function listSavedArrangements() {
  const { rows } = await pool.query(
    `SELECT a.id, a.name, a.materials_cost, a.markup_multiplier, a.total_cost, a.selling_price, a.profit,
            COALESCE(json_agg(json_build_object('flower_name', i.flower_name, 'stems', i.stems))
                     FILTER (WHERE i.id IS NOT NULL), '[]') AS items
       FROM arrangements a
       LEFT JOIN arrangement_items i ON i.arrangement_id = a.id
      GROUP BY a.id
      ORDER BY a.updated_at DESC, a.id DESC
      LIMIT 25`
  );
  return rows;
}

function numberOr(value, fallback) {
  const n = Number(value);
  return value === undefined || value === null || !Number.isFinite(n) ? fallback : n;
}

function round(n) {
  return Math.round(n * 100) / 100;
}

async function runTool(name, input, proposals) {
  switch (name) {
    case "list_flowers":
      return getCatalog();
    case "get_settings":
      return readSettings();
    case "list_saved_arrangements":
      return listSavedArrangements();
    case "price_arrangement":
      return priceArrangement(input);
    case "propose_arrangement": {
      const name = String(input?.name ?? "").trim();
      if (!name) throw new Error("name is required.");
      const proposal = { name, ...(await priceArrangement(input)) };
      proposals.push(proposal);
      return { shown_to_user: true, ...proposal };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Runs one user turn. `messages` is the full API-format history the client
// got back from the previous turn, ending with the new user message; it is
// only ever appended to (never edited), which keeps prompt caching and
// thinking-block replay valid across turns.
export async function runAgentTurn(messages, { client = new Anthropic() } = {}) {
  const history = [...messages];
  const proposals = [];

  for (let turn = 0; turn < MAX_TOOL_ROUNDS; turn++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      // On a safety decline, re-run the request on a fallback model chosen
      // by the API instead of returning a refusal.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: history,
    });
    history.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      return { messages: history, reply: replyText(response), proposals };
    }

    const results = await Promise.all(
      response.content
        .filter((block) => block.type === "tool_use")
        .map(async (block) => {
          try {
            const output = await runTool(block.name, block.input, proposals);
            return { type: "tool_result", tool_use_id: block.id, content: JSON.stringify(output) };
          } catch (err) {
            return { type: "tool_result", tool_use_id: block.id, content: err.message, is_error: true };
          }
        })
    );
    history.push({ role: "user", content: results });
  }

  return {
    messages: history,
    reply: "I wasn't able to finish that one — try narrowing the request a little.",
    proposals,
  };
}

function replyText(response) {
  if (response.stop_reason === "refusal") {
    return "Sorry, I can't help with that request.";
  }
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
  if (response.stop_reason === "max_tokens") {
    return `${text}\n\n(My reply was cut short — ask me to continue.)`.trim();
  }
  return text || "Done.";
}
