/**
 * Turn orchestration: run the agent (live) or the deterministic planner, then ALWAYS
 * re-validate the proposed groups and build cards from code. Also: demo controls and selection.
 */
import { Session, buildCards, DATA_NOTICE, type TurnResult, type Mode } from "./session.js";
import { Trace } from "./trace.js";
import { deterministicTurn, type PlanOutput } from "../agent/deterministic.js";
import type { AgentRun } from "../agent/agent.js";
import type { Trace as TraceT } from "./trace.js";

/** Any live agent implementation: server (Anthropic SDK) or the in-browser preview (claude.ai sample capability). */
export type AgentRunner = (session: Session, text: string, trace: TraceT) => Promise<AgentRun>;
import { validateGroups, recommend } from "../core/engine.js";
import { explainGroup } from "../core/explain.js";
import { score } from "../core/engine.js";

export interface Pricing { inputPerMTokUSD: number | null; outputPerMTokUSD: number | null }

export interface TurnOptions { onEvent?: (e: import("./trace.js").TraceEvent) => void }
export async function handleTurn(session: Session, text: string, agent: AgentRunner | null, pricing?: Pricing, opts: TurnOptions = {}): Promise<TurnResult> {
  const trace = new Trace(opts.onEvent);
  const t0 = Date.now();
  session.turns++;
  trace.add("request", "Passenger message", { text, snapshotVersion: session.availability.version, stateRevision: session.state.revision });
  const prevGroups = JSON.stringify(session.state.lastRecommendation?.groups ?? []);
  let plan: PlanOutput;
  let mode: Mode = agent ? "live" : "deterministic";
  session.lastUserText = text;
  let metrics: TurnResult["metrics"] = { latencyMs: 0, toolCalls: 0 };
  if (agent) {
    try {
      const r = await agent(session, text, trace);
      plan = r;
      const cost = pricing?.inputPerMTokUSD != null && pricing.outputPerMTokUSD != null ? (r.inputTokens * pricing.inputPerMTokUSD + r.outputTokens * pricing.outputPerMTokUSD) / 1e6 : null;
      metrics = { latencyMs: 0, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUSD: cost, modelCalls: r.modelCalls, toolCalls: r.toolCalls };
    } catch (e: any) {
      trace.add("fallback", `Model path failed (${e.message}); answering with the deterministic planner`, undefined, { status: "error" });
      mode = "deterministic-fallback";
      plan = await deterministicTurn(session, text, trace);
      metrics.toolCalls = plan.toolCalls;
    }
  } else {
    plan = await deterministicTurn(session, text, trace);
    metrics.toolCalls = plan.toolCalls;
  }
  const { cards, rejected } = plan.groups.length ? buildCards(session, plan.groups, trace) : { cards: [], rejected: [] };
  let message = plan.message;
  if (rejected.length) message += `\n\n(${rejected.length} proposed option${rejected.length > 1 ? "s were" : " was"} removed because it failed validation.)`;
  metrics.latencyMs = Date.now() - t0;
  trace.add("final", `Answer ready: ${cards.length} validated group(s)${plan.question ? ", with a question" : ""}`, { latencyMs: metrics.latencyMs }, { seats: cards.flatMap((c) => c.seats) });
  const noFeasible = trace.events.some((e) => e.kind === "tool_result" && e.title.startsWith("findAdjacentSeatGroups → no_feasible"));
  const unchanged = JSON.stringify(cards.map((c) => c.seats)) === prevGroups;
  const outcome: TurnResult["outcome"] = plan.rowExplanation ? "explain_row" : plan.comparison ? "compare" : plan.question && (unchanged || !cards.length) && !noFeasible ? "clarify" : cards.length ? "recommend" : noFeasible ? "no_feasible" : plan.question ? "clarify" : "info";
  return { outcome, mode, message, question: plan.question, groups: cards, rejected, comparison: plan.comparison, rowExplanation: plan.rowExplanation,
    state: session.state, snapshotVersion: session.availability.version, trace: trace.events, metrics, dataNotice: DATA_NOTICE };
}

/** Demo control: a recommended seat is taken by someone else. Real recovery: new snapshot, revalidate, re-plan with the SAME preferences. */
export function simulateSeatTaken(session: Session, seatId?: string): TurnResult {
  const trace = new Trace();
  const t0 = Date.now();
  const target = (seatId ?? session.state.lastRecommendation?.groups?.[0]?.[0] ?? "").toUpperCase();
  if (!session.ds.seats.has(target)) {
    trace.add("note", "No recommended seat to take", undefined, { status: "warn" });
    return blank(session, trace, "There is no current recommendation to disrupt yet. Ask for seats first.", t0);
  }
  const prevVersion = session.availability.version;
  const snap = session.availability.markTaken([target], `demo: ${target} taken by another passenger`);
  trace.add("snapshot", `Availability snapshot v${prevVersion} → v${snap.version}: ${target} is no longer available`, { note: snap.note }, { status: "warn", seats: [target] });
  const before = session.state.lastRecommendation?.groups ?? [];
  const reval = validateGroups(before, session.state, session.ctx());
  trace.add("validation", `Revalidated previous recommendation: ${reval.groups.filter((g) => !g.valid).length} of ${before.length} now invalid`, reval, { status: reval.valid ? "ok" : "warn", seats: before.flat() });
  const r = recommend(session.state, session.ctx(), { topK: 3 });
  trace.add("candidates", `Re-planned with unchanged preferences (state revision ${session.state.revision}): ${r.feasibleCount} feasible`, { status: r.status });
  const { cards } = buildCards(session, r.ranked.map((c) => c.seats), trace);
  const msg = cards.length
    ? `${target} was just taken (availability snapshot v${snap.version}). Your requirements and preferences are unchanged. Updated best option: row ${cards[0].row}, ${cards[0].seats.join(", ")}, total £${cards[0].totalGBP}.`
    : `${target} was just taken (snapshot v${snap.version}) and nothing else satisfies your requirements now. Which requirement would you like to relax?`;
  return { ...blank(session, trace, msg, t0), mode: "recovery", groups: cards, outcome: cards.length ? "recommend" : "no_feasible" };
}

/** Selecting demo seats: revalidated against the latest snapshot first. Not a booking. */
export function selectSeats(session: Session, seats: string[]): TurnResult {
  const trace = new Trace();
  const t0 = Date.now();
  const v = validateGroups([seats], session.state, session.ctx());
  trace.add("validation", `Pre-selection check against snapshot v${session.availability.version}: ${v.valid ? "valid" : "invalid"}`, v, { status: v.valid ? "ok" : "error", seats });
  if (!v.valid) {
    const r = recommend(session.state, session.ctx(), { topK: 3 });
    const { cards } = buildCards(session, r.ranked.map((c) => c.seats), trace);
    return { ...blank(session, trace, `Those seats can't be selected any more (${v.groups[0].errors.join("; ")}). Here are the current valid options.`, t0), mode: "recovery", groups: cards, outcome: cards.length ? "recommend" : "no_feasible" };
  }
  session.state = { ...session.state, selection: { seats: v.groups[0].seats, snapshotVersion: session.availability.version } };
  const g = session.ds.seats.get(seats[0])!;
  const card = explainGroup({ id: seats.join("+"), seats: v.groups[0].seats, row: g.row, block: g.block, totalGBP: v.groups[0].totalGBP!, ...score({ id: "", seats: v.groups[0].seats, row: g.row, block: g.block, totalGBP: v.groups[0].totalGBP! }, session.state, session.ds) }, session.state, session.ds);
  return { ...blank(session, trace, `Demo seats selected: ${seats.join(", ")} (total £${v.groups[0].totalGBP}, sample prices). This is a prototype: nothing has been booked with any airline.`, t0), outcome: "selected", groups: [card] };
}

function blank(session: Session, trace: Trace, message: string, t0: number): TurnResult {
  return { outcome: "info", mode: "deterministic", message, groups: [], rejected: [], state: session.state, snapshotVersion: session.availability.version, trace: trace.events,
    metrics: { latencyMs: Date.now() - t0, toolCalls: 0 }, dataNotice: DATA_NOTICE };
}
