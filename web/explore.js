/* "Explore this seat": the few seat controls that help someone judge a seat — window shade, tray table, reading light
   and a bounded recline preview. When a seat is entered, that seat's instanced back and the tray on the seat ahead are
   swapped for standalone meshes that move about their real hinge points (detachSeatParts in cabin3d.js).
   Only what the layout supports is offered: no shade away from the window, no seat-back tray in row 1.
   Controls live in the panel's drawer (ui.js renders it from EXPLORE.state()). */
"use strict";

/* tiny tween system (frame-rate independent; instant with reduced motion) */
const TW = { list: [], add(dur, fn, done) { if (reduce || dur <= 0) { fn(1); done && done(); return; } this.list.push({ t0: performance.now(), dur, fn, done }); dirty = true; },
  step(t) { if (!this.list.length) return false; const fin = [];
    for (const a of [...this.list]) { const k = Math.max(0, Math.min(1, (t - a.t0) / a.dur)), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; a.fn(e); if (k >= 1) fin.push(a); }
    this.list = this.list.filter((a) => !fin.includes(a)); for (const a of fin) a.done && a.done(); return true; },
  clear() { for (let n = 0; n < 8 && this.list.length; n++) { const l = this.list; this.list = []; for (const a of l) { a.fn(1); a.done && a.done(); } } this.list = []; } };
FRAME_HOOKS.push((t) => TW.step(t));

/* free camera used by the recline preview */
const FREECAM = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
function camTo(pos, look, dur, done) { const p0 = FREECAM.pos.clone(), q0 = FREECAM.quat.clone(), q1 = quatLook(pos, look);
  TW.add(dur, (e) => { FREECAM.pos.lerpVectors(p0, pos, e); FREECAM.quat.copy(q0).slerp(q1, e); dirty = true; }, done); }

/* one permanent reading-light spot: adding/removing lights would force every material to recompile */
const READ_SPOT = new THREE.SpotLight(0xffe2b8, 0, 2.4, 0.32, 0.55, 1.6); scene.add(READ_SPOT, READ_SPOT.target);
const RIG = { id: null, group: new THREE.Group(), det: [], meshes: {}, st: {}, sup: {}, why: {}, pivots: {}, shade: null };
scene.add(RIG.group);
function lampPos(s) { const side = s.letter <= "C" ? -1 : 1, k = { A: 2, B: 1, C: 0, D: 0, E: 1, F: 2 }[s.letter]; return new THREE.Vector3(side * (1.33 + k * 0.08), 1.603, backZ[s.row] - 0.34 + 0.02); }
function nearestShade(s) { const side = s.letter <= "C" ? -1 : 1, z = backZ[s.row] - 0.25; let b = null; for (const sh of SHADES) if (sh.side === side && (!b || Math.abs(sh.z - z) < Math.abs(b.z - z))) b = sh; return b; }
function pivotRot(meshes, pivot, axis) { const base = meshes.map((m) => m.matrix.clone()), T = new THREE.Matrix4(), R = new THREE.Matrix4(), Ti = new THREE.Matrix4();
  return (ang) => { T.makeTranslation(pivot.x, pivot.y, pivot.z); R.makeRotationAxis(axis, ang); Ti.makeTranslation(-pivot.x, -pivot.y, -pivot.z); const M_ = T.clone().multiply(R).multiply(Ti); meshes.forEach((m, i) => m.matrix.multiplyMatrices(M_, base[i])); shadowSoon(); dirty = true; }; }
/* moving parts refresh the (static) shadow map once they stop, not on every animation frame */
let shadowT = 0; function shadowSoon() { clearTimeout(shadowT); shadowT = setTimeout(() => { renderer.shadowMap.needsUpdate = true; dirty = true; }, 120); }

function rigDetach() {
  TW.clear(); for (const d of RIG.det) d.restore(); RIG.det = [];
  while (RIG.group.children.length) RIG.group.remove(RIG.group.children[0]);
  READ_SPOT.intensity = 0; RIG.id = null; RIG.meshes = {}; RIG.pivots = {}; RIG.shade = null; reclineBusy = false; RIG.recline = null;
}
function rigAttach(id) {
  rigDetach(); const s = SEATS[id]; RIG.id = id; const ahead = s.row > 1 ? SEATS[(s.row - 1) + s.letter] : null;
  const add = (owner, parts) => { const d = detachSeatParts(owner, parts); RIG.det.push(d); for (const m of d.meshes) RIG.group.add(m); return d.meshes; };
  const back = add(id, ["back", "tray"]);
  RIG.sup = { shade: s.position === "window", tray: !!ahead, light: true, recline: true };
  RIG.why = { shade: "Only the window seat has a shade within reach.", tray: "Row 1 faces the bulkhead; its tray folds out of the armrest (not modelled)." };
  if (ahead) { // the tray on the seat ahead swings down about its lower edge; the turn-button latch rotates first
    const ms = add(ahead.id, ["tray"]), tray = ms.filter((m) => m.geometry === P.tray), latch = ms.filter((m) => m.geometry === P.latch);
    const bm = new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().makeTranslation(seatX(ahead.letter), 0, backZ[ahead.row]), new THREE.Matrix4().compose(new THREE.Vector3(0, PIVOT_Y, PIVOT_Z), new THREE.Quaternion().setFromEuler(new THREE.Euler(reclineA(ahead), 0, 0)), new THREE.Vector3(1, 1, 1)));
    const yt = 0.6 * BH, piv = new THREE.Vector3(0, yt - 0.122, shellZ(0.6) + 0.012).applyMatrix4(bm), lc = new THREE.Vector3(0, yt + 0.155, shellZ(0.8) + 0.006).applyMatrix4(bm);
    RIG.pivots.tray = { rot: pivotRot(tray, piv, new THREE.Vector3(1, 0, 0)), latch: pivotRot(latch, lc, new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(reclineA(ahead), 0, 0)))), open: Math.PI / 2 - (reclineA(ahead) - 0.03) };
  }
  { const piv = new THREE.Vector3(seatX(s.letter), PIVOT_Y, backZ[s.row] + PIVOT_Z); RIG.pivots.recline = { rot: pivotRot(back, piv, new THREE.Vector3(1, 0, 0)), max: s.recline === "limited" ? 0.07 : 0.2 }; }
  { const lp = lampPos(s), lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.0175, 0.0175, 0.004, 24), M.ledOff.clone()); lamp.position.copy(lp).add(new THREE.Vector3(0, -0.003, 0)); RIG.group.add(lamp); RIG.meshes.lamp = lamp;
    READ_SPOT.intensity = 0; READ_SPOT.position.copy(lp).add(new THREE.Vector3(0, -0.02, 0)); READ_SPOT.target.position.set(seatX(s.letter), 0.55, backZ[s.row] - 0.32); READ_SPOT.target.updateMatrixWorld(); }
  if (RIG.sup.shade) RIG.shade = nearestShade(s);
  RIG.st = { shade: RIG.shade ? (RIG.shade.sm.scale.y > 0.5 ? "down" : "up") : null, tray: false, light: false };
  renderer.shadowMap.needsUpdate = true; dirty = true;
}

/* ---------- actions ---------- */
function act(k) {
  if (!RIG.id || view === "T") return false; if (!RIG.sup[k]) { ui.toast(RIG.why[k] || "Not available on this seat"); return false; }
  if (k === "shade") { const sh = RIG.shade, from = sh.sm.scale.y, to = from > 0.5 ? 0.02 : 1; RIG.st.shade = to > 0.5 ? "down" : "up"; TW.add(700, (e) => { sh.set(from + (to - from) * e); shadowSoon(); dirty = true; }); }
  else if (k === "tray") { const p = RIG.pivots.tray, open = !RIG.st.tray; RIG.st.tray = open;
    if (open) TW.add(260, (e) => p.latch(e * Math.PI / 2), () => TW.add(820, (e) => p.rot(e * p.open)));
    else TW.add(820, (e) => p.rot((1 - e) * p.open), () => TW.add(260, (e) => p.latch((1 - e) * Math.PI / 2))); }
  else if (k === "light") { RIG.st.light = !RIG.st.light; const on = RIG.st.light; RIG.meshes.lamp.material.emissive.setRGB(on ? 1.8 : 0, on ? 1.6 : 0, on ? 1.25 : 0); TW.add(180, (e) => { READ_SPOT.intensity = (on ? e : 1 - e) * 2.2; dirty = true; }); }
  else if (k === "recline") { if (view === "R") finishRecline(); else reclinePreview(); }
  ui.syncExplore(); return true;
}

/* recline preview: step into the aisle behind the seat, recline it within its range, report the change in space behind */
let reclineBusy = false;
function reclinePreview() {
  if (reclineBusy || !RIG.id || !["F", "W", "L"].includes(view)) return; reclineBusy = true;
  const s = SEATS[RIG.id], p = RIG.pivots.recline, side = s.letter <= "C" ? -1 : 1, behind = SEATS[(s.row + 1) + s.letter];
  FREECAM.pos.copy(camera.position); FREECAM.quat.copy(camera.quaternion); RIG.recline = { from: camera.position.clone(), prev: view, m: behindSpace(s, p.max), behind: behind ? behind.id : null }; view = "R"; ui.sync();
  const zb = backZ[s.row], pos = new THREE.Vector3(side * 0.2, 1.42, zb + 1.05), look = new THREE.Vector3(seatX(s.letter) * 0.85, 0.7, zb + 0.05);
  camTo(pos, look, 1100, () => TW.add(1300, (e) => p.rot(e * p.max)));
}
function finishRecline() {
  if (!reclineBusy || !RIG.recline) return; const p = RIG.pivots.recline, r = RIG.recline;
  TW.add(700, (e) => p.rot((1 - e) * p.max), () => camTo(r.from, r.from.clone().add(dirFrom(yaw, pitch)), 900, () => { view = r.prev; reclineBusy = false; RIG.recline = null; ui.sync(); dirty = true; }));
}
/* How far this seat back moves toward the passenger behind when reclined by `extra` radians, at a given height, using the
   same pivot and shell profile as the 3D model, plus the modelled knee space behind before/after. */
function zRear(h, ang) { const t = Math.max(0, Math.min(1, (h - PIVOT_Y) / BH)); return new THREE.Vector3(0, h - PIVOT_Y, shellZ(t)).applyAxisAngle(new THREE.Vector3(1, 0, 0), ang).z; }
function behindSpace(s, extra) { const a0 = reclineA(s), shift = (h) => zRear(h, a0 + extra) - zRear(h, a0), ks = s.row < 30 ? kneeSpace(s.row + 1) : null;
  return { knee: ks ? Math.round(ks.d * 100) : null, kneeAfter: ks ? Math.round((ks.d - shift(KNEE_Y)) * 100) : null, trayMove: Math.round(shift(0.86) * 100), limited: s.recline === "limited" }; }

window.addEventListener("keydown", (ev) => { if (view === "R" && ev.key === "Escape") { ev.stopImmediatePropagation(); finishRecline(); } }, true);
const EXPLORE = { act, finishRecline, state: () => ({ id: RIG.id, sup: RIG.sup, st: RIG.st, why: RIG.why, recline: RIG.recline, busy: TW.list.length > 0 }) };
window.EXPLORE = EXPLORE;
window.onSeatEnter = (id) => { rigAttach(id); ui.syncExplore(); };
window.onSeatLeave = () => { rigDetach(); ui.syncExplore(); };
