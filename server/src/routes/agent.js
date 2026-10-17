import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { runAgentTurn } from "../agent.js";

const router = Router();

// Caps the history a client can send, so a runaway conversation fails
// fast instead of growing every request without bound.
const MAX_HISTORY_MESSAGES = 200;

router.post("/", async (req, res, next) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: "The assistant isn't set up yet: add an ANTHROPIC_API_KEY environment variable to the server.",
    });
  }

  const messages = req.body?.messages;
  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > MAX_HISTORY_MESSAGES ||
    messages[messages.length - 1]?.role !== "user"
  ) {
    return res.status(400).json({ error: "Send the conversation as a messages array ending with a user message." });
  }

  try {
    res.json(await runAgentTurn(messages));
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "The assistant is busy right now — try again in a moment." });
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return res.status(503).json({ error: "The assistant's API key was rejected — check ANTHROPIC_API_KEY." });
    }
    if (err instanceof Anthropic.APIError) {
      console.error(err);
      return res.status(502).json({ error: "The assistant ran into a problem. Please try again." });
    }
    next(err);
  }
});

export default router;
