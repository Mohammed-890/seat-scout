/** Structured trip state: updated by patches that touch only the fields they name. */
import { StatePatch, TripState, HardConstraints, Preferences, type Traveller } from "./schemas.js";

export function initialState(): TripState {
  return TripState.parse({
    revision: 0, travellers: [], budget: { totalGBP: null, perSeatGBP: null }, together: true,
    hard: HardConstraints.parse({}), prefs: Preferences.parse({}), heightCm: null, excludedSeats: [],
    lastRecommendation: null, selection: null,
  });
}

/** Seats needed: infants (under 2) travel on an adult's lap in this demo policy. */
export const seatsNeeded = (s: TripState) => s.travellers.filter((t) => t.type !== "infant").length;
export const hasMinor = (s: TripState) => s.travellers.some((t) => t.type !== "adult");

export interface PatchResult { state: TripState; changed: string[]; warnings: string[] }

export function applyPatch(prev: TripState, rawPatch: unknown): PatchResult {
  const patch = StatePatch.parse(rawPatch);
  const s: TripState = structuredClone(prev);
  const changed: string[] = [];
  const warnings: string[] = [];
  if (patch.setTravellers) { s.travellers = patch.setTravellers; changed.push("travellers"); }
  if (patch.addTravellers?.length) { s.travellers.push(...patch.addTravellers); changed.push("travellers"); }
  if (patch.removeTravellers) {
    const { type, count } = patch.removeTravellers;
    let left = count;
    for (let i = s.travellers.length - 1; i >= 0 && left > 0; i--) {
      if (type === "any" || s.travellers[i].type === type) { s.travellers.splice(i, 1); left--; }
    }
    if (left > 0) warnings.push(`could only remove ${count - left} of ${count} travellers`);
    changed.push("travellers");
  }
  if (patch.budgetTotalGBP !== undefined) { s.budget.totalGBP = patch.budgetTotalGBP; changed.push("budget.totalGBP"); }
  if (patch.budgetPerSeatGBP !== undefined) { s.budget.perSeatGBP = patch.budgetPerSeatGBP; changed.push("budget.perSeatGBP"); }
  if (patch.together !== undefined) { s.together = patch.together; changed.push("together"); }
  if (patch.hard) for (const [k, v] of Object.entries(patch.hard)) { (s.hard as any)[k] = v; changed.push(`hard.${k}`); }
  if (patch.prefs) for (const [k, v] of Object.entries(patch.prefs)) { (s.prefs as any)[k] = v; changed.push(`prefs.${k}`); }
  if (patch.heightCm !== undefined) { s.heightCm = patch.heightCm; changed.push("heightCm"); }
  if (patch.excludeSeats?.length) { s.excludedSeats = [...new Set([...s.excludedSeats, ...patch.excludeSeats])]; changed.push("excludedSeats"); }
  if (s.travellers.length > 9) throw new Error("party too large");
  if (changed.length) s.revision = prev.revision + 1;
  return { state: TripState.parse(s), changed: [...new Set(changed)], warnings };
}

export function describeTravellers(t: Traveller[]): string {
  if (!t.length) return "party size unknown";
  const n = (k: string) => t.filter((x) => x.type === k).length;
  const parts = [];
  if (n("adult")) parts.push(`${n("adult")} adult${n("adult") > 1 ? "s" : ""}`);
  if (n("child")) parts.push(`${n("child")} child${n("child") > 1 ? "ren" : ""}`);
  if (n("infant")) parts.push(`${n("infant")} infant${n("infant") > 1 ? "s" : ""} (on lap)`);
  return parts.join(", ");
}
