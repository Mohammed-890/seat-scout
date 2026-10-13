/**
 * A session = one passenger's isolated state: trip preferences, availability snapshots,
 * conversation memory and fault injections. Both the HTTP server and the in-browser preview use this.
 */
import { AvailabilityStore, type Dataset } from "../core/dataset.js";
import { initialState, describeTravellers, seatsNeeded } from "../core/state.js";
import type { TripState } from "../core/schemas.js";
import { recommend, validateGroups, score, type Ctx, type EngineResult } from "../core/engine.js";
import { explainGroup, type CardGroup } from "../core/explain.js";
import { TOOL_BY_NAME } from "../agent/tools.js";
import { Trace, type TraceEvent } from "./trace.js";

export type Mode = "live" | "deterministic" | "deterministic-fallback" | "recovery";
export interface TurnMetrics { latencyMs: number; model?: string; inputTokens?: number; outputTokens?: number; costUSD?: number | null; modelCalls?: number; toolCalls: number }
export interface TurnResult {
  mode: Mode; message: string; question?: string; groups: CardGroup[]; rejected: Array<{ seats: string[]; errors: string[] }>;
  comparison?: unknown; rowExplanation?: unknown; state: TripState; snapshotVersion: number; trace: TraceEvent[]; metrics: TurnMetrics;
  dataNotice: string;
}
export const DATA_NOTICE = "Demo data: illustrative cabin, sample prices and synthetic availability. Not an airline booking.";

export class Session {
  state: TripState = initialState();
  availability: AvailabilityStore;
  modelHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
  lastEngine: EngineResult | null = null;
  faults = { toolTimeoutOnce: false };
  turns = 0;
  constructor(readonly id: string, readonly ds: Dataset, snapshot: unknown) { this.availability = new AvailabilityStore(snapshot); }
  ctx(): Ctx { return { ds: this.ds, isFree: (id) => this.availability.isFree(id) }; }
}

export interface ToolOutcome { ok: boolean; output?: unknown; error?: string; ms: number }

/** Validated, time-limited tool execution with trace events. Shared by every planner. */
export async function executeTool(session: Session, name: string, rawInput: unknown, trace: Trace, opts: { timeoutMs?: number } = {}): Promise<ToolOutcome> {
  const tool = TOOL_BY_NAME.get(name);
  const t0 = Date.now();
  if (!tool) { trace.add("tool_error", `Unknown tool ${name}`, { rawInput }, { status: "error" }); return { ok: false, error: `unknown tool ${name}`, ms: 0 }; }
  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const error = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
    trace.add("tool_error", `${name}: invalid arguments`, { rawInput, error }, { status: "error" });
    return { ok: false, error: `invalid arguments: ${error}`, ms: Date.now() - t0 };
  }
  trace.add("tool_call", name, { arguments: parsed.data });
  const timeoutMs = opts.timeoutMs ?? 3000;
  try {
    const injected = session.faults.toolTimeoutOnce && (name === "findAdjacentSeatGroups");
    if (injected) session.faults.toolTimeoutOnce = false;
    const work = injected ? new Promise((r) => setTimeout(() => r(tool.run(session, parsed.data)), timeoutMs + 500)) : Promise.resolve().then(() => tool.run(session, parsed.data));
    const output = await Promise.race([work, new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${timeoutMs} ms${injected ? " (demo fault injection)" : ""}`)), timeoutMs))]);
    const ms = Date.now() - t0;
    trace.add("tool_result", `${name} → ${summarise(name, output)}`, output, { status: "ok", seats: seatsIn(name, output) });
    return { ok: true, output, ms };
  } catch (e: any) {
    trace.add("tool_error", `${name}: ${e.message}`, undefined, { status: "error" });
    return { ok: false, error: e.message, ms: Date.now() - t0 };
  }
}

function summarise(name: string, o: any): string {
  if (name === "findAdjacentSeatGroups") return `${o.status}: ${o.feasibleCount}/${o.candidatesConsidered} groups feasible`;
  if (name === "validateRecommendation" || name === "submitRecommendation") return (o.valid ?? o.accepted) ? "valid" : "rejected";
  if (name === "updateTripPreferences") return `changed ${o.changed.join(", ") || "nothing"}`;
  if (name === "searchAvailableSeats") return `${o.count} seats`;
  if (name === "getSeatEvidence") return o.row ? `row ${o.row.row}: ${o.row.groups.length} groups explained` : `${o.seats.length} seats`;
  return "ok";
}
function seatsIn(name: string, o: any): string[] | undefined {
  if (name === "findAdjacentSeatGroups") return o.ranked?.flatMap((g: any) => g.seats);
  if (name === "validateRecommendation") return o.groups?.flatMap((g: any) => g.seats);
  if (name === "getSeatEvidence") return o.row ? o.row.groups.flatMap((g: any) => g.group.split("+")) : o.seats?.map((x: any) => x.seat);
  return undefined;
}

/** Turns validated groups into cards. Totals, facts and scores come from code, never from the model. */
export function buildCards(session: Session, groups: string[][], trace: Trace) {
  const v = validateGroups(groups, session.state, session.ctx());
  const cards: CardGroup[] = [];
  const rejected: Array<{ seats: string[]; errors: string[] }> = [];
  for (const g of v.groups) {
    if (!g.valid) { rejected.push({ seats: g.seats, errors: g.errors }); continue; }
    const seat0 = session.ds.seats.get(g.seats[0])!;
    const cand = { id: g.seats.join("+"), seats: g.seats, row: seat0.row, block: seat0.block, totalGBP: g.totalGBP! };
    cards.push(explainGroup({ ...cand, ...score(cand, session.state, session.ds) }, session.state, session.ds));
  }
  trace.add("validation", rejected.length ? `Final validation: ${cards.length} accepted, ${rejected.length} rejected` : `Final validation: ${cards.length} group(s) accepted against snapshot v${session.availability.version}`,
    { accepted: cards.map((c) => ({ seats: c.seats, totalGBP: c.totalGBP })), rejected }, { status: rejected.length ? "warn" : "ok", seats: cards.flatMap((c) => c.seats) });
  if (cards.length) session.state = { ...session.state, lastRecommendation: { groups: cards.map((c) => c.seats), snapshotVersion: session.availability.version } };
  return { cards, rejected };
}

export function engineTraceEvents(r: EngineResult, trace: Trace) {
  trace.add("candidates", `${r.candidatesConsidered} side-by-side groups of ${r.seatsNeeded} considered, ${r.feasibleCount} feasible`, { seatsNeeded: r.seatsNeeded });
  const examples = Object.fromEntries(Object.keys(r.exclusionCounts).map((code) => [code, r.exclusions.filter((e) => e.reasons.some((x) => x.code === code)).slice(0, 3).map((e) => ({ group: e.id, detail: e.reasons.find((x) => x.code === code)!.detail }))]));
  trace.add("exclusions", `Excluded: ${Object.entries(r.exclusionCounts).map(([k, v]) => `${k} ×${v}`).join(", ") || "none"}`, { counts: r.exclusionCounts, examples },
    { seats: r.exclusions.slice(0, 40).flatMap((e) => e.seats) });
  if (r.ranked.length) trace.add("scores", `Ranked by preferences: ${r.ranked.map((c) => `${c.id} (${c.score})`).join(", ")}`, r.ranked.map((c) => ({ group: c.id, totalGBP: c.totalGBP, score: c.score, components: c.components })), { seats: r.ranked.flatMap((c) => c.seats) });
  if (r.conflicts.length) trace.add("note", "No feasible group: relaxation analysis", r.conflicts, { status: "warn" });
}

export function stateSummary(s: TripState): string[] {
  const p: string[] = [describeTravellers(s.travellers)];
  if (s.budget.totalGBP != null) p.push(`total ≤ £${s.budget.totalGBP}`);
  if (s.budget.perSeatGBP != null) p.push(`≤ £${s.budget.perSeatGBP} per seat`);
  if (seatsNeeded(s) > 1) p.push("seated together");
  if (s.hard.position) p.push(`must include a ${s.hard.position} seat`);
  if (s.hard.clearViewRequired) p.push("window must not look onto the wing");
  if (s.hard.exitRowOnly) p.push("exit row only");
  if (s.hard.zone) p.push(`${s.hard.zone} cabin`);
  if (s.hard.fullRecline) p.push("full recline");
  if (s.hard.underSeatBag) p.push("bag under the seat");
  if (s.hard.avoidToilets) p.push("away from the toilets");
  if (s.travellers.some((t) => t.type !== "adult")) p.push("demo policy: no exit rows with children");
  return p;
}
export function prefSummary(s: TripState): string[] {
  const names: Record<string, string> = { window: "window", aisle: "aisle", clearView: "away from the wing", legroom: "legroom", quiet: "quiet", front: "near the front", cheap: "lower price" };
  return Object.entries(s.prefs).filter(([, v]) => v > 0).map(([k]) => names[k]);
}

export { recommend };
