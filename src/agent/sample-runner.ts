/**
 * Live agent for the in-browser preview (claude.ai artifact). Claude runs on the VIEWER's own claude.ai
 * account through the artifact `sample` capability; no API key exists in the page.
 * Same tools, same validated executor, same trace as the server agent. The platform bounds the rounds;
 * we add an overall timeout and still require submitRecommendation for seat cards.
 */
import { TOOLS } from "./tools.js";
import { systemPrompt, AgentFailure, LIMITS, type AgentRun } from "./agent.js";
import { executeTool, engineTraceEvents } from "../app/session.js";
import type { AgentRunner } from "../app/turn.js";

type SampleFn = ((input: unknown, opts: any) => Promise<{ text: string; truncated: boolean; modelTierApplied?: string; modelApplied?: string }>);

export function sampleRunner(sample: SampleFn, opts: { modelTier?: "quick" | "default" | "complex"; timeoutMs?: number } = {}): AgentRunner {
  return async (session, text, trace): Promise<AgentRun> => {
    let submitted: { message: string; groups: string[][]; question?: string } | null = null;
    let toolCalls = 0;
    const tools = TOOLS.map((t) => ({
      name: t.name, description: t.description.slice(0, 1000), inputSchema: t.jsonSchema,
      async execute(input: unknown) {
        toolCalls++;
        const out = await executeTool(session, t.name, input, trace, { timeoutMs: LIMITS.toolTimeoutMs });
        if (t.name === "findAdjacentSeatGroups" && out.ok && session.lastEngine) engineTraceEvents(session.lastEngine, trace);
        if (!out.ok) throw new Error(out.error);
        if (t.name === "submitRecommendation" && (out.output as any).accepted) submitted = input as any;
        return out.output;
      },
    }));
    const history = session.modelHistory.slice(-8);
    const turns = [...history, { role: "user" as const, content: text }];
    turns[0] = { ...turns[0], content: `${systemPrompt(session)}\n\n---\nPassenger: ${turns[0].content}` };
    const t0 = Date.now();
    const tier = opts.modelTier ?? "default";
    trace.add("model_call", `claude.ai sample() with ${tools.length} tools (tier: ${tier}, viewer's account)`);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 120_000);
    try {
      const r = await sample(turns, { tools, modelTier: tier, signal: ctl.signal });
      trace.add("model_call", `sample() finished in ${Date.now() - t0} ms${r.truncated ? " (truncated)" : ""}`, { modelTierApplied: r.modelTierApplied, modelApplied: r.modelApplied ?? null, note: "token usage is not exposed to the page" });
      const model = `claude (${r.modelTierApplied ?? tier} tier via claude.ai)`;
      const s = submitted as { message: string; groups: string[][]; question?: string } | null;
      if (s) {
        session.modelHistory.push({ role: "user", content: text }, { role: "assistant", content: s.message });
        return { message: s.message, question: s.question, groups: s.groups, toolCalls, modelCalls: 1, inputTokens: 0, outputTokens: 0, model, completed: true };
      }
      const last = r.text.split(/\n\s*\n/).filter(Boolean).pop() ?? r.text;
      session.modelHistory.push({ role: "user", content: text }, { role: "assistant", content: last });
      trace.add("note", "Model answered without submitRecommendation: shown as text, no seat cards", undefined, { status: "warn" });
      return { message: last, groups: [], toolCalls, modelCalls: 1, inputTokens: 0, outputTokens: 0, model, completed: false };
    } catch (e: any) {
      if (e?.code === "cancelled") throw new AgentFailure(`timed out after ${opts.timeoutMs ?? 120_000} ms`);
      throw new AgentFailure(e?.code ? `${e.code}: ${e.message ?? ""}` : String(e?.message ?? e));
    } finally { clearTimeout(timer); }
  };
}
