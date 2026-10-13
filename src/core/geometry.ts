/**
 * Cabin geometry shared by the 3D model and the measurements.
 * Knee space and window alignment are computed from the same numbers the 3D seats are built from,
 * so a value shown in a recommendation card is the value you can see in the Legroom view.
 */
import type { CabinConfig, RowConfig } from "./schemas.js";

export const LETTERS = ["A", "B", "C", "D", "E", "F"] as const;
export const SEAT_BACK_HEIGHT = 0.72;
export const PIVOT_Y = 0.42;
export const PIVOT_Z = 0.02;
export const EYE_Y = 1.19;
export const KNEE_Y = 0.6;
/** Average buttock-to-knee length as a share of stature. Population average only: not a fit prediction. */
export const KNEE_RATIO = 0.33;

const gauss = (t: number, c: number, w: number) => Math.exp(-((t - c) / w) * ((t - c) / w));
export const shellZ = (t: number) => 0.012 + 0.058 * (1 - 0.32 * t) + 0.022 * Math.sin(Math.PI * t);
export const padZ = (t: number, xn: number) =>
  -0.012 - 0.03 * gauss(t, 0.3, 0.16) - 0.012 * gauss(t, 0.86, 0.08) - 0.022 * Math.pow(Math.min(1, Math.abs(xn)), 3) * (t < 0.75 ? 1 : 0.4);

export interface CabinGeometry {
  backZ: Record<number, number>;
  bulkheadZ: number;
  windowsZ: number[];
  seatX(letter: string): number;
  reclineAngle(row: number): number;
  backRearZ(row: number, y: number): number;
  ownBackZ(row: number): number;
  kneeSpace(row: number): { own: number; ahead: number; meters: number };
  eye(row: number, letter: string): [number, number, number];
}

export function buildGeometry(cfg: CabinConfig): CabinGeometry {
  const g = cfg.geometry;
  const rows = new Map<number, RowConfig>(cfg.rows.map((r) => [r.row, r]));
  const backZ: Record<number, number> = { 0: 0 };
  let z = 0;
  for (const r of cfg.rows) { z += r.pitchIn * g.inchesToMeters; backZ[r.row] = z; }
  const bulkheadZ = backZ[1] - 0.92;
  const windowsZ: number[] = [];
  for (let w = bulkheadZ + 0.3; w < backZ[cfg.rows.length] + 0.3; w += g.windowPitchM) windowsZ.push(w);
  const reclineAngle = (row: number) => (rows.get(row)?.recline === "limited" ? 0.08 : 0.16);
  const seatX = (letter: string) => {
    const i = LETTERS.indexOf(letter as any), side = i < 3 ? -1 : 1, k = i < 3 ? 2 - i : i - 3;
    return side * (g.aisleWidthM / 2 + g.seatWidthM / 2 + k * g.seatWidthM);
  };
  const backRearZ = (row: number, y: number) => {
    const a = reclineAngle(row);
    let yl = (y - PIVOT_Y) / Math.cos(a);
    for (let k = 0; k < 3; k++) { const zz = shellZ(Math.max(0, yl / SEAT_BACK_HEIGHT)); yl = (y - PIVOT_Y + zz * Math.sin(a)) / Math.cos(a); }
    let zz = shellZ(Math.max(0, yl / SEAT_BACK_HEIGHT));
    if (yl > 0.12 && yl < 0.28) zz += 0.026; // seat pocket
    return backZ[row] + PIVOT_Z + yl * Math.sin(a) + zz * Math.cos(a);
  };
  const ownBackZ = (row: number) => backZ[row] + PIVOT_Z + 0.04 * Math.sin(reclineAngle(row)) + padZ(0.05, 0);
  const kneeSpace = (row: number) => {
    const ahead = row === 1 ? bulkheadZ : backRearZ(row - 1, KNEE_Y);
    const own = ownBackZ(row);
    return { own, ahead, meters: own - ahead };
  };
  return { backZ, bulkheadZ, windowsZ, seatX, reclineAngle, backRearZ, ownBackZ, kneeSpace,
    eye: (row, letter) => [seatX(letter), EYE_Y, backZ[row] - 0.01] };
}

export type WindowAlignment = "beside" | "slightly_ahead" | "slightly_behind" | "between_windows";
export function windowAlignment(geo: CabinGeometry, row: number): WindowAlignment {
  const ez = geo.backZ[row] - 0.01;
  let best = geo.windowsZ[0];
  for (const w of geo.windowsZ) if (Math.abs(w - ez) < Math.abs(best - ez)) best = w;
  const d = best - ez;
  if (Math.abs(d) < 0.12) return "beside";
  if (Math.abs(d) > 0.2) return "between_windows";
  return d < 0 ? "slightly_ahead" : "slightly_behind";
}
