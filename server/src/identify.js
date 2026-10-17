import Anthropic from "@anthropic-ai/sdk";
import { BRAND } from "./brand.js";

// Identifies a stationery item from a photo: either matches it to an
// existing inventory item or suggests the fields for a new one. Uses
// structured output so the reply is always parseable JSON.

const MODEL = "claude-opus-5-5";
const DATA_URL = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

// A photo the model couldn't or wouldn't identify; shown to the user as-is.
export class IdentifyError extends Error {}

export function parseImageDataUrl(value) {
  const match = typeof value === "string" ? DATA_URL.exec(value) : null;
  return match ? { mediaType: match[1], data: match[2] } : null;
}

function resultSchema(categoryKeys) {
  return {
    type: "object",
    properties: {
      is_stationery: {
        type: "boolean",
        description: "False if the photo doesn't show florist stationery or packaging.",
      },
      category: { type: "string", enum: categoryKeys },
      suggested_name: {
        type: "string",
        description: "Short inventory name, e.g. 'Blush satin ribbon 2.5cm' or 'Kraft bloom bag large'.",
      },
      color: { type: "string", description: "Main colour(s), e.g. 'blush pink' or 'white with gold foil'." },
      suggested_unit: { type: "string", description: "How it's counted: rolls, sheets, pcs, packs, or metres." },
      description: { type: "string", description: "One sentence describing what's in the photo." },
      estimated_count: {
        type: ["integer", "null"],
        description: "How many units are visible, only if they can be counted reliably; otherwise null.",
      },
      matched_item_id: {
        type: ["integer", "null"],
        description: "id of the existing inventory item this is, or null if none matches.",
      },
      match_confidence: { type: "string", enum: ["high", "medium", "low", "none"] },
    },
    required: [
      "is_stationery",
      "category",
      "suggested_name",
      "color",
      "suggested_unit",
      "description",
      "estimated_count",
      "matched_item_id",
      "match_confidence",
    ],
    additionalProperties: false,
  };
}

export async function identifyItem(imageDataUrl, inventory, categories, { client = new Anthropic() } = {}) {
  const image = parseImageDataUrl(imageDataUrl);
  const categoryList = Object.entries(categories)
    .map(([key, label]) => `${key} (${label})`)
    .join(", ");

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: resultSchema(Object.keys(categories)) } },
    system:
      `You identify florist stationery and packaging from photos for ${BRAND.name}'s inventory: wrapping paper, ` +
      "ribbons, bloom bags, greeting cards and tags. Match the photo against the existing inventory when it is " +
      "clearly the same product (same type and colour); otherwise leave matched_item_id null and suggest a new item. " +
      "Prefer the naming style already used in the inventory.",
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
          {
            type: "text",
            text:
              `Categories: ${categoryList}.\n\n` +
              `Current inventory (JSON):\n${JSON.stringify(inventory)}\n\n` +
              "What item is this?",
          },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new IdentifyError("Sorry, I can't identify that photo.");
  }
  let result;
  try {
    result = JSON.parse(response.content.find((block) => block.type === "text")?.text ?? "");
  } catch {
    throw new IdentifyError("Couldn't read that photo — try a clearer, closer shot.");
  }

  // Only trust a match that points at an item that really exists.
  const matched = inventory.find((item) => item.id === result.matched_item_id) ?? null;
  return { ...result, matched_item_id: matched?.id ?? null, matched_item: matched };
}
