/**
 * Live baseline for comparison: the same model, same settings, NO tools and NO constraint engine.
 * It gets the seat table and policy in the prompt and must answer with JSON. Its output is checked
 * by the same property checks as the tool-grounded agent. (Only runs with ANTHROPIC_API_KEY.)
 */
import { loadSnapshot } from "../src/core/load-node.js";
import type { ModelClient } from "../src/agent/agent.js";
import type { Dataset } from "../src/core/dataset.js";
import { initialState } from "../src/core/state.js";
import type { Case, CaseRun } from "./checks.js";

export async function llmBaseline(c: Case, model: ModelClient, ds: Dataset): Promise<CaseRun> {
  const snap = loadSnapshot();
  const table = ds.seatList.map((s) => `${s.id},${s.position},£${s.priceGBP},${s.pitchIn}in,${s.exitRow ? "exit" : ""},${s.windowView ?? ""},${snap.takenSeats.includes(s.id) ? "TAKEN" : "free"}`).join("\n");
  const system = `You recommend airline seats. Demo policy: ${JSON.stringify(ds.policy)}. Seats (id,position,price,pitch,exit,view,availability):\n${table}\nReply ONLY with JSON {"message": string, "groups": [["14A","14B"]], "outcome": "recommend"|"no_feasible"|"clarify"}.`;
  const messages: any[] = [];
  const t0 = Date.now();
  let res: any = null, tokens = { input: 0, output: 0 }, calls = 0;
  for (const turn of c.turns) {
    if (typeof turn !== "string") { messages.push({ role: "user", content: "Note: the first seat of your last recommendation was just taken by someone else." }); }
    else messages.push({ role: "user", content: turn });
    const r = await model.create({ system, messages, tools: [], max_tokens: 800 }, { timeoutMs: 30000 });
    calls++; tokens.input += r.usage?.input_tokens ?? 0; tokens.output += r.usage?.output_tokens ?? 0;
    const text = r.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    messages.push({ role: "assistant", content: text });
    try { res = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { res = { message: text, groups: [], outcome: "info" }; }
  }
  // The baseline's own totals are NOT trusted; we recompute nothing here so the checker sees exactly what it claimed.
  const groups = (res.groups ?? []).map((g: string[]) => ({ seats: g, totalGBP: g.reduce((a: number, id: string) => a + (ds.seats.get(String(id).toUpperCase())?.priceGBP ?? NaN), 0) }));
  const result = { outcome: res.outcome ?? (groups.length ? "recommend" : "info"), mode: "live", message: res.message ?? "", groups, trace: [] } as any;
  return { result, state: initialState(), takenSeats: snap.takenSeats, takenByDemo: [], prevTopTotal: null, latencyMs: Date.now() - t0, tokens, modelCalls: calls, model: model.name };
}
