/**
 * Deterministic constraint engine.
 * Hard constraints (availability, budget, adjacency, demo eligibility policy, must-haves) are enforced here,
 * never by the model. Preferences only rank the feasible groups, and every score has named components.
 */
import type { Dataset, Seat } from "./dataset.js";
import type { TripState } from "./schemas.js";
import { seatsNeeded, hasMinor } from "./state.js";
import { LETTERS } from "./geometry.js";

export type ReasonCode =
  | "UNAVAILABLE" | "EXCLUDED_BY_USER" | "OVER_TOTAL_BUDGET" | "OVER_SEAT_BUDGET" | "EXIT_ROW_POLICY"
  | "POSITION_REQUIRED" | "ZONE" | "RECLINE" | "NO_UNDER_SEAT_BAG" | "NEAR_TOILETS" | "VIEW_REQUIRED" | "EXIT_ROW_ONLY";

export interface Reason { code: ReasonCode; detail: string; seats?: string[] }
export interface Candidate { id: string; seats: string[]; row: number; block: "left" | "right"; totalGBP: number }
export interface ScoredCandidate extends Candidate { score: number; components: Record<string, number> }
export interface Exclusion extends Candidate { reasons: Reason[] }

export interface EngineResult {
  status: "ok" | "no_feasible" | "needs_info";
  seatsNeeded: number;
  candidatesConsidered: number;
  feasibleCount: number;
  ranked: ScoredCandidate[];       // top options, one per row
  exclusions: Exclusion[];         // every excluded candidate with explicit reasons
  exclusionCounts: Partial<Record<ReasonCode, number>>;
  conflicts: Relaxation[];         // only when nothing is feasible
  missing: string[];
}
export interface Relaxation { change: string; field: string; wouldMatch: number; example?: Candidate; note?: string }

/** All contiguous same-row, same-block groups of n seats (the only shape "sitting together" can take in 3-3). */
export function enumerateGroups(ds: Dataset, n: number): Candidate[] {
  const out: Candidate[] = [];
  const blocks: Array<["left" | "right", string[]]> = [["left", ["A", "B", "C"]], ["right", ["D", "E", "F"]]];
  for (const rowCfg of ds.config.rows) {
    for (const [block, letters] of blocks) {
      for (let i = 0; i + n <= letters.length; i++) {
        const seats = letters.slice(i, i + n).map((l) => `${rowCfg.row}${l}`);
        out.push({ id: seats.join("+"), seats, row: rowCfg.row, block,
          totalGBP: seats.reduce((a, id) => a + ds.seats.get(id)!.priceGBP, 0) });
      }
    }
  }
  return out;
}

export interface Ctx { ds: Dataset; isFree: (id: string) => boolean }

export function evaluate(c: Candidate, s: TripState, ctx: Ctx): Reason[] {
  const { ds } = ctx;
  const seats = c.seats.map((id) => ds.seats.get(id)!);
  const r: Reason[] = [];
  const taken = c.seats.filter((id) => !ctx.isFree(id));
  if (taken.length) r.push({ code: "UNAVAILABLE", detail: `${taken.join(", ")} not available`, seats: taken });
  const excl = c.seats.filter((id) => s.excludedSeats.includes(id));
  if (excl.length) r.push({ code: "EXCLUDED_BY_USER", detail: `${excl.join(", ")} ruled out by you`, seats: excl });
  if (s.budget.totalGBP != null && c.totalGBP > s.budget.totalGBP)
    r.push({ code: "OVER_TOTAL_BUDGET", detail: `total £${c.totalGBP} > £${s.budget.totalGBP}` });
  if (s.budget.perSeatGBP != null) {
    const over = seats.filter((x) => x.priceGBP > s.budget.perSeatGBP!);
    if (over.length) r.push({ code: "OVER_SEAT_BUDGET", detail: `${over.map((x) => `${x.id} £${x.priceGBP}`).join(", ")} > £${s.budget.perSeatGBP} per seat`, seats: over.map((x) => x.id) });
  }
  const p = ds.policy.exitRow;
  if (seats[0].exitRow && hasMinor(s) && (!p.allowChildren || !p.allowInfants))
    r.push({ code: "EXIT_ROW_POLICY", detail: `exit row: demo policy requires everyone in the row's group to be ${p.minAge}+` });
  if (s.hard.exitRowOnly && !seats[0].exitRow) r.push({ code: "EXIT_ROW_ONLY", detail: "not an exit row" });
  if (s.hard.position && !seats.some((x) => x.position === s.hard.position))
    r.push({ code: "POSITION_REQUIRED", detail: `no ${s.hard.position} seat in this group` });
  if (s.hard.zone && seats[0].zone !== s.hard.zone) r.push({ code: "ZONE", detail: `in the ${seats[0].zone} cabin, not ${s.hard.zone}` });
  if (s.hard.fullRecline && seats[0].recline !== "full") r.push({ code: "RECLINE", detail: "limited recline" });
  if (s.hard.underSeatBag && !seats[0].underSeatStorage) r.push({ code: "NO_UNDER_SEAT_BAG", detail: "no bag under the seat in front" });
  if (s.hard.avoidToilets && seats[0].nearToilets) r.push({ code: "NEAR_TOILETS", detail: "next to the rear toilets" });
  if (s.hard.clearViewRequired && !seats.some((x) => x.windowView === "clear"))
    r.push({ code: "VIEW_REQUIRED", detail: "no window with a clear view (wing or no window)" });
  return r;
}

/** Transparent scoring: every point is attributable to a named preference or a stated default. */
export function score(c: Candidate, s: TripState, ds: Dataset): { score: number; components: Record<string, number> } {
  const seats = c.seats.map((id) => ds.seats.get(id)!);
  const w = s.prefs;
  const comp: Record<string, number> = {};
  const add = (k: string, v: number) => { if (Math.abs(v) > 1e-9) comp[k] = Math.round(v * 10) / 10; };
  const win = seats.find((x) => x.position === "window");
  add("window", w.window * (win ? 6 : 0));
  add("aisle", w.aisle * (seats.some((x) => x.position === "aisle") ? 6 : 0));
  add("clearView", w.clearView * (win?.windowView === "clear" ? 4 : win?.windowView === "partial_wing" ? 1 : 0));
  add("legroom", w.legroom * (seats[0].kneeSpaceCm - 59) * 0.6);
  add("quiet", w.quiet * (seats[0].noiseEstimate === "quiet" ? 3 : 0));
  add("front", w.front * (30 - c.row) * 0.25);
  add("price", -(0.15 + 0.25 * w.cheap) * c.totalGBP / Math.max(1, c.seats.length));
  if (seats.length === 1 && seats[0].position === "middle") add("middleSeatDefault", -2.5);
  const total = Object.values(comp).reduce((a, b) => a + b, 0);
  return { score: Math.round(total * 10) / 10, components: comp };
}

const RELAXABLE: Array<{ field: string; label: string; drop: (s: TripState) => TripState; applies: (s: TripState) => boolean }> = [
  { field: "budget.totalGBP", label: "raise the total budget", applies: (s) => s.budget.totalGBP != null, drop: (s) => ({ ...s, budget: { ...s.budget, totalGBP: null } }) },
  { field: "budget.perSeatGBP", label: "raise the per-seat budget", applies: (s) => s.budget.perSeatGBP != null, drop: (s) => ({ ...s, budget: { ...s.budget, perSeatGBP: null } }) },
  { field: "hard.position", label: "drop the seat-position requirement", applies: (s) => !!s.hard.position, drop: (s) => ({ ...s, hard: { ...s.hard, position: null } }) },
  { field: "hard.zone", label: "allow any part of the cabin", applies: (s) => !!s.hard.zone, drop: (s) => ({ ...s, hard: { ...s.hard, zone: null } }) },
  { field: "hard.clearViewRequired", label: "accept a wing view", applies: (s) => s.hard.clearViewRequired, drop: (s) => ({ ...s, hard: { ...s.hard, clearViewRequired: false } }) },
  { field: "hard.fullRecline", label: "accept limited recline", applies: (s) => s.hard.fullRecline, drop: (s) => ({ ...s, hard: { ...s.hard, fullRecline: false } }) },
  { field: "hard.underSeatBag", label: "put bags overhead", applies: (s) => s.hard.underSeatBag, drop: (s) => ({ ...s, hard: { ...s.hard, underSeatBag: false } }) },
  { field: "hard.avoidToilets", label: "accept rows near the toilets", applies: (s) => s.hard.avoidToilets, drop: (s) => ({ ...s, hard: { ...s.hard, avoidToilets: false } }) },
  { field: "hard.exitRowOnly", label: "allow non-exit rows", applies: (s) => s.hard.exitRowOnly, drop: (s) => ({ ...s, hard: { ...s.hard, exitRowOnly: false } }) },
  { field: "excludedSeats", label: "reconsider seats you ruled out", applies: (s) => s.excludedSeats.length > 0, drop: (s) => ({ ...s, excludedSeats: [] }) },
];

export function recommend(s: TripState, ctx: Ctx, opts: { topK?: number } = {}): EngineResult {
  const n = seatsNeeded(s);
  const missing: string[] = [];
  if (n === 0) missing.push("party size");
  if (n > ctx.ds.policy.maxGroupSize) missing.push(`groups larger than ${ctx.ds.policy.maxGroupSize} cannot sit in one 3-seat block in this cabin`);
  if (s.travellers.length && s.travellers.every((t) => t.type !== "adult")) missing.push("an adult traveller (demo policy: children sit with an adult)");
  const base = { seatsNeeded: n, candidatesConsidered: 0, feasibleCount: 0, ranked: [], exclusions: [], exclusionCounts: {}, conflicts: [], missing };
  if (missing.length) return { status: "needs_info", ...base };

  const all = enumerateGroups(ctx.ds, n);
  const exclusions: Exclusion[] = [];
  const feasible: ScoredCandidate[] = [];
  const counts: Partial<Record<ReasonCode, number>> = {};
  for (const c of all) {
    const reasons = evaluate(c, s, ctx);
    if (reasons.length) { exclusions.push({ ...c, reasons }); for (const r of reasons) counts[r.code] = (counts[r.code] ?? 0) + 1; }
    else feasible.push({ ...c, ...score(c, s, ctx.ds) });
  }
  feasible.sort((a, b) => b.score - a.score || a.totalGBP - b.totalGBP || a.row - b.row || a.id.localeCompare(b.id));
  const ranked: ScoredCandidate[] = [];
  const rows = new Set<number>();
  for (const f of feasible) { if (rows.has(f.row)) continue; rows.add(f.row); ranked.push(f); if (ranked.length >= (opts.topK ?? 3)) break; }

  let conflicts: Relaxation[] = [];
  if (!feasible.length) {
    for (const rx of RELAXABLE.filter((x) => x.applies(s))) {
      const s2 = rx.drop(s);
      const ok = all.filter((c) => evaluate(c, s2, ctx).length === 0).map((c) => ({ ...c, ...score(c, s2, ctx.ds) }));
      ok.sort((a, b) => a.totalGBP - b.totalGBP || b.score - a.score);
      if (ok.length) {
        const note = rx.field === "budget.totalGBP" ? `lowest feasible total is £${ok[0].totalGBP}` : undefined;
        conflicts.push({ change: rx.label, field: rx.field, wouldMatch: ok.length, example: ok[0], note });
      }
    }
    if (n > 1) {
      const any = enumerateGroups(ctx.ds, 1).filter((c) => evaluate(c, { ...s, travellers: [{ type: "adult" }] }, ctx).length === 0);
      conflicts.push({ change: "sit apart", field: "together", wouldMatch: 0,
        note: `not offered: this assistant never splits a party. ${any.length} single seats would fit the other limits` });
    }
  }
  return { status: feasible.length ? "ok" : "no_feasible", seatsNeeded: n, candidatesConsidered: all.length, feasibleCount: feasible.length,
    ranked, exclusions, exclusionCounts: counts, conflicts, missing };
}

/** The cheapest feasible group (ties broken by preference score), for "compare with the cheapest valid option". */
export function cheapestFeasible(s: TripState, ctx: Ctx): ScoredCandidate | null {
  const ok = enumerateGroups(ctx.ds, seatsNeeded(s)).filter((c) => evaluate(c, s, ctx).length === 0).map((c) => ({ ...c, ...score(c, s, ctx.ds) }));
  ok.sort((a, b) => a.totalGBP - b.totalGBP || b.score - a.score || a.row - b.row);
  return ok[0] ?? null;
}

/* ---------- independent validation of any proposed recommendation ---------- */
export interface GroupValidation { seats: string[]; valid: boolean; totalGBP: number | null; errors: string[] }
/** Re-checks a proposal from scratch. Deliberately does not reuse enumerateGroups, so a bug there cannot hide here. */
export function validateGroups(groups: string[][], s: TripState, ctx: Ctx): { valid: boolean; groups: GroupValidation[] } {
  const res = groups.map((raw) => {
    const seats = raw.map((x) => String(x).trim().toUpperCase());
    const errors: string[] = [];
    const known = seats.map((id) => ctx.ds.seats.get(id));
    if (known.some((x) => !x)) {
      return { seats, valid: false, totalGBP: null, errors: [`unknown seat id: ${seats.filter((_, i) => !known[i]).join(", ")}`] };
    }
    const ss = known as Seat[];
    if (new Set(seats).size !== seats.length) errors.push("duplicate seat");
    const n = seatsNeeded(s);
    if (seats.length !== n) errors.push(`needs ${n} seat(s), got ${seats.length}`);
    if (ss.some((x) => x.row !== ss[0].row)) errors.push("not in one row");
    const idx = ss.map((x) => LETTERS.indexOf(x.letter as any)).sort((a, b) => a - b);
    if (!idx.every((v) => (v < 3) === (idx[0] < 3))) errors.push("crosses the aisle");
    if (!idx.every((v, k) => k === 0 || v === idx[k - 1] + 1)) errors.push("not side by side");
    const totalGBP = ss.reduce((a, x) => a + x.priceGBP, 0);
    const cand: Candidate = { id: seats.join("+"), seats, row: ss[0].row, block: ss[0].block, totalGBP };
    for (const r of evaluate(cand, s, ctx)) errors.push(`${r.code}: ${r.detail}`);
    return { seats, valid: errors.length === 0, totalGBP, errors };
  });
  return { valid: res.length > 0 && res.every((g) => g.valid), groups: res };
}

/** "Why not row 6?" — every candidate group in that row with its exclusion reasons or rank. */
export function explainRow(row: number, s: TripState, ctx: Ctx) {
  const n = seatsNeeded(s) || 1;
  const all = enumerateGroups(ctx.ds, n).filter((c) => c.row === row);
  const result = recommend(s, ctx, { topK: 30 });
  return all.map((c) => {
    const reasons = evaluate(c, s, ctx);
    const rank = result.ranked.findIndex((x) => x.id === c.id);
    return { group: c.id, totalGBP: c.totalGBP, feasible: reasons.length === 0, reasons, rankAmongRows: rank >= 0 ? rank + 1 : null,
      score: reasons.length ? null : score(c, s, ctx.ds) };
  });
}

export function compareGroups(a: string[], b: string[], s: TripState, ds: Dataset) {
  const pick = (g: string[]) => g.map((id) => ds.seats.get(id)!).filter(Boolean);
  const A = pick(a), B = pick(b);
  if (A.length !== a.length || B.length !== b.length) throw new Error("unknown seat in comparison");
  const tot = (x: Seat[]) => x.reduce((acc, y) => acc + y.priceGBP, 0);
  const win = (x: Seat[]) => x.find((y) => y.position === "window") ?? null;
  const h = s.heightCm;
  return {
    a: a.join("+"), b: b.join("+"),
    totalGBP: { a: tot(A), b: tot(B), delta: tot(B) - tot(A), status: "calculated" },
    pitchIn: { a: A[0].pitchIn, b: B[0].pitchIn, delta: B[0].pitchIn - A[0].pitchIn, status: "synthetic" },
    kneeSpaceCm: { a: A[0].kneeSpaceCm, b: B[0].kneeSpaceCm, delta: B[0].kneeSpaceCm - A[0].kneeSpaceCm, status: "estimated" },
    clearanceCm: h ? { a: ds.clearanceCm(A[0], h), b: ds.clearanceCm(B[0], h), status: "estimated", caveat: "height-based average; individual fit varies" } : null,
    window: { a: win(A) ? { view: win(A)!.windowView, alignment: win(A)!.windowAlignment } : null, b: win(B) ? { view: win(B)!.windowView, alignment: win(B)!.windowAlignment } : null },
    recline: { a: A[0].recline, b: B[0].recline },
    underSeatStorage: { a: A[0].underSeatStorage, b: B[0].underSeatStorage },
    noise: { a: A[0].noiseEstimate, b: B[0].noiseEstimate, status: "estimated" },
    row: { a: A[0].row, b: B[0].row },
  };
}
