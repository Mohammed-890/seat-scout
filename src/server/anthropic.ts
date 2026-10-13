/** Server-side model client. The API key is read from the environment and never leaves the server. */
import Anthropic from "@anthropic-ai/sdk";
import type { ModelClient, ModelRequest, ModelResponse } from "../agent/agent.js";

export function anthropicClient(apiKey: string, model: string): ModelClient {
  const client = new Anthropic({ apiKey, maxRetries: 1 });
  return {
    name: model,
    async create(req: ModelRequest, opts: { timeoutMs: number }): Promise<ModelResponse> {
      const res = await client.messages.create(
        { model, system: req.system, messages: req.messages, tools: req.tools as any, max_tokens: req.max_tokens, temperature: 0 },
        { timeout: opts.timeoutMs },
      );
      return { content: res.content as any, stop_reason: res.stop_reason ?? "unknown", usage: res.usage, model: res.model };
    },
  };
}
