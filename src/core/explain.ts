/**
 * Grounded explanations. Every statement is tagged with what kind of claim it is:
 *   fact        - straight from the (synthetic) dataset
 *   calculated  - arithmetic done by code (totals, deltas)
 *   judgement   - how an option fits the passenger's stated preferences
 *   estimate    - uncertain values (knee space from the model, noise zone, body clearance)
 */
import type { Dataset, Seat } from "./dataset.js";
import type { TripState } from "./schemas.js";
import type { ScoredCandidate } from "./engine.js";

export type StatementKind = "fact" | "calculated" | "judgement" | "estimate";
export interface Statement { kind: StatementKind; text: string; refs: string[] }
export interface CardGroup {
  seats: string[]; row: number; totalGBP: number; score: number; components: Record<string, number>;
  statements: Statement[]; strengths: string[]; compromises: string[]; valid: true;
}

const ALIGN: Record<string, string> = { beside: "lines up with the seat", slightly_ahead: "slightly ahead of the seat", slightly_behind: "slightly behind the seat", between_windows: "falls between two windows" };
const VIEW: Record<string, string> = { clear: "a clear view (not over the wing)", wing: "a view onto the wing", partial_wing: "a partial wing view" };

export function explainGroup(c: ScoredCandidate, s: TripState, ds: Dataset): CardGroup {
  const seats = c.seats.map((id) => ds.seats.get(id)!) as Seat[];
  const st: Statement[] = [];
  const strengths: string[] = [];
  const compromises: string[] = [];
  const win = seats.find((x) => x.position === "window");
  const priceParts = seats.map((x) => `£${x.priceGBP}`).join(" + ");
  st.push({ kind: "fact", text: `Row ${c.row}, seats ${c.seats.join(", ")}${seats.length > 1 ? ", side by side in one block" : ""}.`, refs: c.seats });
  st.push({ kind: "calculated", text: `Total £${c.totalGBP}${seats.length > 1 ? ` (${priceParts})` : ""}${s.budget.totalGBP != null ? `, within the £${s.budget.totalGBP} total budget` : ""}.`, refs: c.seats });
  if (win) st.push({ kind: "fact", text: `${win.id} is a window seat with ${VIEW[win.windowView!]}.`, refs: [win.id] });
  if (win) st.push({ kind: "estimate", text: `The window ${ALIGN[win.windowAlignment!]} (estimated from the cabin model's window spacing).`, refs: [win.id] });
  st.push({ kind: "fact", text: `${seats[0].pitchIn}″ seat pitch${seats[0].exitRow ? ", exit row" : ""}${seats[0].bulkhead ? ", bulkhead row" : ""}.`, refs: [c.seats[0]] });
  st.push({ kind: "estimate", text: `Knee space about ${seats[0].kneeSpaceCm} cm, measured in the cabin model, not on a real aircraft.`, refs: [c.seats[0]] });
  if (s.heightCm) st.push({ kind: "estimate", text: `Estimated knee clearance at ${s.heightCm} cm: ${ds.clearanceCm(seats[0], s.heightCm)} cm (population-average proportions; height alone doesn't predict fit).`, refs: [c.seats[0]] });
  st.push({ kind: "estimate", text: `Noise estimate for this zone: ${seats[0].noiseEstimate.replace("_", " ")}.`, refs: [c.seats[0]] });

  if (s.prefs.window && win) { strengths.push("has the window you asked for"); st.push({ kind: "judgement", text: "Meets your window preference.", refs: [win.id] }); }
  if (s.prefs.window && !win) { compromises.push("no window seat"); st.push({ kind: "judgement", text: "Misses your window preference.", refs: c.seats }); }
  if (s.prefs.clearView && win?.windowView === "clear") { strengths.push("window is away from the wing"); st.push({ kind: "judgement", text: "Meets your away-from-the-wing preference.", refs: [win.id] }); }
  if (s.prefs.clearView && win && win.windowView !== "clear") { compromises.push(`window looks onto the wing (row ${c.row})`); st.push({ kind: "judgement", text: "Window view is partly blocked by the wing.", refs: [win.id] }); }
  if (s.prefs.aisle && seats.some((x) => x.position === "aisle")) strengths.push("includes an aisle seat");
  if (s.prefs.legroom && seats[0].pitchIn > 29) strengths.push(`${seats[0].pitchIn - 29}″ more pitch than standard rows`);
  if (s.prefs.front && c.row <= 10) strengths.push("near the front");
  if (s.budget.totalGBP != null) strengths.push(`£${s.budget.totalGBP - c.totalGBP} under budget`);
  if (seats[0].recline === "limited") compromises.push("limited recline");
  if (seats[0].nearToilets) compromises.push("next to the rear toilets");
  if (!seats[0].underSeatStorage) compromises.push("bags must go overhead");
  if (seats[0].noiseEstimate !== "quiet") compromises.push(`noisier zone (estimate: ${seats[0].noiseEstimate.replace("_", " ")})`);
  if (win?.windowAlignment === "between_windows") compromises.push("window is between seats, not beside the window seat (estimate)");
  if (seats.length === 1 && seats[0].position === "middle") compromises.push("middle seat");
  return { seats: c.seats, row: c.row, totalGBP: c.totalGBP, score: c.score, components: c.components, statements: st, strengths, compromises, valid: true };
}
