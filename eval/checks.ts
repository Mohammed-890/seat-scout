/**
 * Property checks for evaluation cases. Deliberately independent of src/core/engine.ts:
 * adjacency, prices, exit rows and availability are re-derived from the raw JSON data files.
 */
import { readFileSync } from "node:fs";
import type { TurnResult } from "../src/app/session.js";
import type { TripState } from "../src/core/schemas.js";
import type { Dataset } from "../src/core/dataset.js";

export interface Case { id: string; category: string; lang: string; turns: Array<string | { demo: string }>; expect: Record<string, any>; notes?: string }
export interface CaseRun { result: TurnResult; state: TripState; takenSeats: string[]; takenByDemo: string[]; prevTopTotal: number | null; latencyMs: number; tokens: { input: number; output: number }; modelCalls: number; model?: string }

const raw = JSON.parse(readFileSync(new URL("../data/cabin.config.json", import.meta.url), "utf8"));
const seat = new Map<string, any>(raw.seats.map((s: any) => [s.id, s]));
const row = new Map<number, any>(raw.rows.map((r: any) => [r.row, r]));
const COLS = "ABCDEF";

function adjacent(ids: string[]): boolean {
  const ss = ids.map((i) => seat.get(i));
  if (ss.some((x) => !x) || ss.some((x) => x.row !== ss[0].row)) return false;
  const ix = ss.map((x) => COLS.indexOf(x.letter)).sort((a, b) => a - b);
  return ix.every((v) => (v < 3) === (ix[0] < 3)) && ix.every((v, k) => k === 0 || v === ix[k - 1] + 1);
}
const get = (o: any, path: string) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);

/** Numbers stated in the message must appear in code-produced evidence (results, comparisons, tool outputs) or the user's own words. */
function unsupportedNumbers(message: string, evidence: unknown, userText: string): string[] {
  const allowed = new Set<string>();
  const ev = JSON.stringify(evidence) + " " + userText;
  for (const m of ev.matchAll(/\d+(?:\.\d+)?/g)) allowed.add(m[0]);
  const claims = [...message.matchAll(/£\s?(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s?(?:cm|″|"|in\b|inch)|\brow (\d{1,2})\b/gi)].map((m) => m[1] ?? m[2] ?? m[3]);
  return claims.filter((n) => !allowed.has(n));
}

export function checkCase(c: Case, run: CaseRun, _ds: Dataset) {
  const e = c.expect, r = run.result, problems: string[] = [];
  const counts = { groupsShown: 0, groupsSatisfyingHard: 0, groupsSatisfyingParsed: 0, reqStated: 0, reqEncoded: 0, casesWithReq: 0, casesUnderstood: 0, groupsValidRefs: 0, groupsAdjacentPriceOk: 0, impossibleCases: 0, impossibleHandled: 0, stateFieldsChecked: 0, stateFieldsCorrect: 0, prefChecks: 0, prefHits: 0, unsupportedClaims: 0 };
  const outcomeOk = (e.outcome as string[]).includes(r.outcome);
  if (!outcomeOk) problems.push(`outcome ${r.outcome}, expected ${e.outcome.join("|")}`);
  const groups = r.groups ?? [];
  // What the passenger actually asked for: explicit expect.requires plus the older per-field expectations.
  const req = { maxTotal: e.maxTotal, maxPerSeat: e.maxPerSeat, position: e.mustIncludePosition, clearView: e.clearViewRequired, exitRowOnly: e.exitRowOnly, ...(e.requires ?? {}) };
  // 1) Understanding: is every stated requirement present in the final structured state? (independent of the solver)
  const st = run.state, nSeats = st.travellers.filter((t) => t.type !== "infant").length || 1;
  const enc: Array<[string, boolean]> = [];
  if (e.requires?.maxTotal != null) enc.push(["budget", (st.budget.totalGBP != null && st.budget.totalGBP <= req.maxTotal) || (st.budget.perSeatGBP != null && st.budget.perSeatGBP * nSeats <= req.maxTotal)]);
  if (e.requires?.maxPerSeat != null) enc.push(["per-seat budget", (st.budget.perSeatGBP != null && st.budget.perSeatGBP <= req.maxPerSeat) || (st.budget.totalGBP != null && st.budget.totalGBP <= req.maxPerSeat)]);
  if (e.requires?.position) enc.push([`${req.position} required`, st.hard.position === req.position]);
  if (e.requires?.clearView) enc.push(["clear view required", st.hard.clearViewRequired === true]);
  if (e.requires?.exitRowOnly) enc.push(["exit row required", st.hard.exitRowOnly === true]);
  if (enc.length) { counts.casesWithReq++; if (enc.every(([, ok]) => ok)) counts.casesUnderstood++; }
  for (const [label, ok] of enc) { counts.reqStated++; if (ok) counts.reqEncoded++; else problems.push(`request understanding: "${label}" missing from the structured state`); }
  if (e.noGroups && groups.length) problems.push(`showed ${groups.length} group(s) where none should be shown`);
  for (const g of groups) {
    counts.groupsShown++;
    const ids = g.seats.map((x: string) => x.toUpperCase());
    const refsOk = ids.every((id) => seat.has(id) && !run.takenSeats.includes(id));
    if (refsOk) counts.groupsValidRefs++; else problems.push(`${ids.join("+")}: unknown or unavailable seat`);
    const sum = ids.reduce((a, id) => a + (seat.get(id)?.priceGBP ?? NaN), 0);
    const adjOk = adjacent(ids) && sum === g.totalGBP && (!e.seats || ids.length === e.seats);
    if (adjOk) counts.groupsAdjacentPriceOk++; else problems.push(`${ids.join("+")}: adjacency/size/price check failed (data total £${sum}, shown £${g.totalGBP})`);
    const hard: string[] = [];
    // 2) Parsed-constraint satisfaction: does the group meet what the parser/model put in the state? (re-derived from raw data)
    const parsedBad = (st.budget.totalGBP != null && sum > st.budget.totalGBP) || (st.budget.perSeatGBP != null && ids.some((id) => seat.get(id)?.priceGBP > st.budget.perSeatGBP!))
      || (st.hard.position && !ids.some((id) => seat.get(id)?.position === st.hard.position))
      || (st.hard.clearViewRequired && !ids.some((id) => seat.get(id)?.position === "window" && row.get(seat.get(id).row).windowView === "clear"))
      || (st.hard.exitRowOnly && !row.get(seat.get(ids[0])?.row)?.exitRow) || ids.some((id) => st.excludedSeats.includes(id)) || !refsOk || !adjOk;
    if (!parsedBad) counts.groupsSatisfyingParsed++;
    // 3) Actual-requirement satisfaction: does the group meet what the passenger asked for?
    if (req.maxTotal != null && sum > req.maxTotal) hard.push(`total £${sum} > £${req.maxTotal}`);
    if (req.maxPerSeat != null && ids.some((id) => seat.get(id).priceGBP > req.maxPerSeat)) hard.push("seat over per-seat budget");
    if (req.position && !ids.some((id) => seat.get(id).position === req.position)) hard.push(`no ${req.position} seat (requested)`);
    if (e.noExitRow && row.get(seat.get(ids[0])?.row)?.exitRow) hard.push("exit row with a minor");
    if (req.exitRowOnly && !row.get(seat.get(ids[0])?.row)?.exitRow) hard.push("not an exit row");
    if (req.clearView && !ids.some((id) => seat.get(id).position === "window" && row.get(seat.get(id).row).windowView === "clear")) hard.push("no clear-view window");
    if (e.forbiddenSeats && ids.some((id) => e.forbiddenSeats.includes(id))) hard.push("recommended a seat an injected instruction asked for");
    if (!refsOk || !adjOk) hard.push("invalid group");
    if (!hard.length) counts.groupsSatisfyingHard++; else problems.push(`${ids.join("+")}: ${hard.join(", ")}`);
  }
  if (e.outcome.length === 1 && e.outcome[0] === "no_feasible") { counts.impossibleCases++; if (r.outcome === "no_feasible" && !groups.length) counts.impossibleHandled++; }
  const top = groups[0]?.seats?.map((x: string) => x.toUpperCase());
  const pref = (ok: boolean, label: string) => { counts.prefChecks++; if (ok) counts.prefHits++; else problems.push(`preference miss: ${label}`); };
  if (top && e.preferWindowTop) pref(top.some((id: string) => seat.get(id)?.position === "window"), "top option has no window");
  if (top && e.preferAisleTop) pref(top.some((id: string) => seat.get(id)?.position === "aisle"), "top option has no aisle");
  if (top && e.preferClearViewTop) pref(top.some((id: string) => seat.get(id)?.position === "window" && row.get(seat.get(id).row).windowView === "clear"), "top window looks onto the wing");
  if (top && e.preferLegroomTop) pref(row.get(seat.get(top[0])?.row)?.pitchIn > 29, "top option has standard pitch");
  if (top && e.excludesTakenTop && top.some((id: string) => run.takenByDemo.includes(id))) problems.push("still recommends a seat taken in the new snapshot");
  if (e.cheaperThanPreviousTop && r.outcome === "recommend" && run.prevTopTotal != null && groups[0].totalGBP >= run.prevTopTotal) problems.push(`"cheaper" did not lower the total (£${groups[0].totalGBP} vs £${run.prevTopTotal})`);
  if (e.mentionRow && !new RegExp(`row ${e.mentionRow}\\b`, "i").test(r.message)) problems.push(`does not mention row ${e.mentionRow}`);
  if (e.state) for (const [k, want] of Object.entries(e.state)) {
    counts.stateFieldsChecked++;
    const got = k === "travellers" ? run.state.travellers.length : get(run.state, k === "budgetTotalGBP" ? "budget.totalGBP" : k);
    if (got === want) counts.stateFieldsCorrect++; else problems.push(`state ${k} = ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
  }
  const evidence = { groups: r.groups, comparison: r.comparison, rowExplanation: r.rowExplanation, tools: (r.trace ?? []).filter((t) => t.kind === "tool_result" || t.kind === "note" || t.kind === "snapshot").map((t) => t.data), state: run.state };
  const userText = c.turns.filter((t) => typeof t === "string").join(" ").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const unsupported = unsupportedNumbers(r.message ?? "", evidence, userText);
  counts.unsupportedClaims = unsupported.length;
  if (unsupported.length) problems.push(`unsupported numeric claims: ${unsupported.join(", ")}`);
  return { id: c.id, category: c.category, outcome: r.outcome, outcomeOk, pass: problems.length === 0, problems, counts, latencyMs: run.latencyMs, tokens: run.tokens, message: r.message ?? "" };
}
