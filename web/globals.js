/*
 * Compatibility layer for the 3D cabin (cabin3d.js), which was written against global names.
 * Every value is derived from the canonical dataset via SeatCore, so the 3D model, seat map and
 * agent tools read the same numbers.
 */
"use strict";
function defineSeatGlobals(config, policy, takenSeats) {
  const C = window.SeatCore;
  const ds = C.createDataset(config, policy);
  const geo = ds.geometry;
  const taken = new Set(takenSeats);
  const viewName = { clear: "clear", wing: "wing", partial_wing: "partial wing" };
  const alignText = { beside: ["ok", "Beside you", 2], slightly_ahead: ["mid", "Slightly ahead", 1], slightly_behind: ["mid", "Slightly behind", 1], between_windows: ["bad", "Between two windows", 0] };
  const access = [["ok", "Direct", 0], ["mid", "Past 1 seat", 1], ["bad", "Past 2 seats", 2]];
  const SEATS = {};
  for (const s of ds.seatList) {
    const a = s.windowAlignment ? alignText[s.windowAlignment] : null, ac = access[s.seatsToPassForAisle];
    const notes = [];
    if (s.bulkhead) notes.push("Bulkhead row: a wall in front instead of a seat; bags go overhead.");
    if (s.exitRow) notes.push(`Exit row (demo policy): everyone ${policy.exitRow.minAge}+, no children or infants; bags go overhead.`);
    if (s.recline === "limited") notes.push("Limited recline in this row.");
    if (s.nearToilets) notes.push("Close to the rear toilets and galley.");
    if (s.windowView === "wing") notes.push("The window looks onto the wing.");
    SEATS[s.id] = { id: s.id, row: s.row, letter: s.letter, position: s.position, pitch: s.pitchIn, recline: s.recline,
      view: s.windowView ? viewName[s.windowView] : "none", noise: s.noiseEstimate.replace("_", " "), price: s.priceGBP, taken: taken.has(s.id),
      exitRow: s.exitRow, zone: s.zone, nearToilets: s.nearToilets, underSeatStorage: s.underSeatStorage, notes,
      kneeCm: s.kneeSpaceCm, align: a ? { k: a[0], t: a[1], rank: a[2] } : null, access: { k: ac[0], t: ac[1], pass: ac[2] } };
  }
  const g = config.geometry;
  const EXIT_ROWS = config.rows.filter((r) => r.exitRow).map((r) => r.row);
  const backZ = geo.backZ, BULK = geo.bulkheadZ, WIN = geo.windowsZ;
  const lastRow = config.rows.length;
  const exitWin = (() => { let b = 0; WIN.forEach((z, i) => { if (Math.abs(z - (backZ[EXIT_ROWS[0]] - 0.3)) < Math.abs(WIN[b] - (backZ[EXIT_ROWS[0]] - 0.3))) b = i; }); return [b, b + 2]; })();
  Object.assign(window, {
    __dataset: ds, SEATS, LETTERS: ["A", "B", "C", "D", "E", "F"], EXIT_ROWS,
    rnd: (i) => { const x = Math.sin(i * 9301.13 + 49297.7) * 233280; return x - Math.floor(x); },
    rowPitch: (r) => config.rows[r - 1].pitchIn, IN: g.inchesToMeters, AISLE: g.aisleWidthM, SW: g.seatWidthM, BH: C.SEAT_BACK_HEIGHT,
    PIVOT_Y: C.PIVOT_Y, PIVOT_Z: C.PIVOT_Z, EYE_Y: C.EYE_Y, KNEE_Y: C.KNEE_Y, KNEE_RATIO: C.KNEE_RATIO,
    seatX: geo.seatX, backZ, BULK, Z0: BULK - 0.35, ZE: backZ[lastRow] + 0.85, R: g.fuselageRadiusM, CY: 1.02, WIN_Y: 1.22, WIN_W: 0.235, WIN_H: 0.335, WP: g.windowPitchM,
    WIN, EXIT_WIN: exitWin, reclineA: (s) => (s.recline === "limited" ? 0.08 : 0.16),
    gauss: (t, c, w) => Math.exp(-((t - c) / w) * ((t - c) / w)), shellZ: C.shellZ, padZ: C.padZ,
    kneeSpace: (r) => { const k = geo.kneeSpace(r); return { own: k.own, ahead: k.ahead, d: k.meters }; },
    cm: (m) => Math.round(m * 100), clearanceCm: (s, h) => Math.round(s.kneeCm - C.KNEE_RATIO * h),
  });
  window.L = window.ZE - window.Z0;
}
