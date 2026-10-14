/* Cabin objects you can use from the selected seat: window shade, tray table, armrests, reading light, seatbelt and a
   bounded recline preview. When a seat is entered, that seat's instanced parts are swapped for standalone meshes that
   can move about their real hinge points (detachSeatParts in cabin3d.js). Only features the layout supports are offered:
   no shade unless you sit by the window, fixed armrests in the bulkhead and exit rows, no seat-back tray in row 1.
   Every control has a 3D hover/focus cue, an on-screen hotspot (keyboard focusable), a toolbar button and a shortcut. */
"use strict";
const byId = (i) => document.getElementById(i), escH = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- tiny tween system (frame-rate independent; instant with reduced motion) ---------- */
const TW = { list: [], add(dur, fn, done) { if (reduce || dur <= 0) { fn(1); done && done(); return; } this.list.push({ t0: performance.now(), dur, fn, done }); dirty = true; },
  // tweens finished this frame are removed first, then their callbacks run, so a callback can start the next tween
  step(t) { if (!this.list.length) return false; const done = [];
    for (const a of [...this.list]) { const k = Math.max(0, Math.min(1, (t - a.t0) / a.dur)), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; a.fn(e); if (k >= 1) done.push(a); }
    this.list = this.list.filter((a) => !done.includes(a)); for (const a of done) a.done && a.done(); return true; },
  clear() { for (let n = 0; n < 8 && this.list.length; n++) { const l = this.list; this.list = []; for (const a of l) { a.fn(1); a.done && a.done(); } } this.list = []; } };
FRAME_HOOKS.push((t) => TW.step(t));

/* free camera used by the recline preview and the aisle-access demo */
const FREECAM = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
function camTo(pos, look, dur, done) {
  const p0 = FREECAM.pos.clone(), q0 = FREECAM.quat.clone(), q1 = quatLook(pos, look);
  TW.add(dur, (e) => { FREECAM.pos.lerpVectors(p0, pos, e); FREECAM.quat.copy(q0).slerp(q1, e); dirty = true; }, done);
}

/* ---------- seat rig ---------- */
/* one permanent reading-light spot: adding/removing lights would force every material to recompile */
const READ_SPOT = new THREE.SpotLight(0xffe2b8, 0, 2.4, 0.32, 0.55, 1.6); scene.add(READ_SPOT, READ_SPOT.target);
const RIG = { id: null, group: new THREE.Group(), det: [], meshes: {}, st: {}, sup: {}, pivots: {}, light: null, beltMesh: null, tried: new Set() };
scene.add(RIG.group);
const seatOf = (row, letter) => SEATS[row + letter];
const LET = ["A", "B", "C", "D", "E", "F"];
function armrestsFor(id) {
  const s = SEATS[id], i = LET.indexOf(s.letter), fixedRow = s.row === 1 || s.exitRow;
  const left = { owner: id, part: "armL", wall: s.letter === "A", aisle: s.letter === "D" };
  const right = s.letter === "C" || s.letter === "F" ? { owner: id, part: "armR", wall: s.letter === "F", aisle: s.letter === "C" } : { owner: s.row + LET[i + 1], part: "armL", wall: false, aisle: false };
  for (const a of [left, right]) { a.raisable = !a.wall && !fixedRow; a.why = a.wall ? "The wall-side armrest is fixed." : fixedRow ? (s.row === 1 ? "Bulkhead row: armrests hold the tray tables and are fixed." : "Exit row: armrests are fixed in this demo layout.") : ""; a.side = a === left ? -1 : 1; }
  return [left, right];
}
function lampPos(s) { const side = s.letter <= "C" ? -1 : 1, k = { A: 2, B: 1, C: 0, D: 0, E: 1, F: 2 }[s.letter]; return new THREE.Vector3(side * (1.33 + k * 0.08), 1.603, backZ[s.row] - 0.34 + 0.02); }
function nearestShade(s) { const side = s.letter <= "C" ? -1 : 1, z = backZ[s.row] - 0.25; let b = null; for (const sh of SHADES) if (sh.side === side && (!b || Math.abs(sh.z - z) < Math.abs(b.z - z))) b = sh; return b; }
function pivotRot(meshes, pivot, axis) { const base = meshes.map((m) => m.matrix.clone()), T = new THREE.Matrix4(), R = new THREE.Matrix4(), Ti = new THREE.Matrix4();
  return (ang) => { T.makeTranslation(pivot.x, pivot.y, pivot.z); R.makeRotationAxis(axis, ang); Ti.makeTranslation(-pivot.x, -pivot.y, -pivot.z); const M = T.clone().multiply(R).multiply(Ti); meshes.forEach((m, i) => m.matrix.multiplyMatrices(M, base[i])); renderer.shadowMap.needsUpdate = true; dirty = true; }; }
const hiMat = new Map(); // per-rig cloned materials for the hover/focus glow
function glowable(m) { const mat = m.material.clone(); mat.emissive = new THREE.Color(0, 0, 0); m.material = mat; hiMat.set(m, mat); return m; }

/* ribbon: a flat strap along a curve (seatbelt webbing is ~48 mm wide, not a tube) */
function ribbon(pts, width = 0.046, thick = 0.003) {
  const curve = new THREE.CatmullRomCurve3(pts), N = 28, pos = [], idx = [], up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= N; i++) { const p = curve.getPoint(i / N), tng = curve.getTangent(i / N), side = new THREE.Vector3().crossVectors(tng, up).normalize(), n = new THREE.Vector3().crossVectors(side, tng).normalize();
    for (const [a, b] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) { const v = p.clone().addScaledVector(side, a * width / 2).addScaledVector(n, b * thick / 2); pos.push(v.x, v.y, v.z); } }
  for (let i = 0; i < N; i++) for (let k = 0; k < 4; k++) { const a = i * 4 + k, b = i * 4 + (k + 1) % 4, c = a + 4, d = b + 4; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
const BELT_MAT = std({ color: 0x1f2633, roughness: 0.8, map: makeFabric([30, 38, 52], 33, 30).map });
const BUCKLE = smoothNormals(plate(0.064, 0.036, 0.01, 0.009, 0.003, 3)), LATCHPLATE = new THREE.BoxGeometry(0.03, 0.006, 0.012), TONGUE = smoothNormals(plate(0.034, 0.05, 0.006, 0.003, 0.0015, 2));
function beltPoints(fastened, side) { // seat-base coordinates; side -1 = left half (buckle), +1 = right half (tongue)
  const x = side;
  return fastened ? [[0.205 * x, 0.4, -0.05], [0.198 * x, 0.452, -0.1], [0.13 * x, 0.474, -0.165], [0.045 * x, 0.477, -0.18]]
    : [[0.205 * x, 0.4, -0.05], [0.205 * x, 0.46, -0.12], [0.19 * x, 0.468, -0.22], [0.16 * x, 0.466, -0.31]];
}
function buildBelt(k) { // k: 0 = unfastened, 1 = fastened (interpolated for the animation)
  const g = new THREE.Group(), s = SEATS[RIG.id];
  for (const side of [-1, 1]) {
    const a = beltPoints(false, side), b = beltPoints(true, side), pts = a.map((p, i) => new THREE.Vector3(...p.map((v, j) => v + (b[i][j] - v) * k)));
    const strap = new THREE.Mesh(ribbon(pts), BELT_MAT); strap.castShadow = true; strap.receiveShadow = true; g.add(strap);
    const end = pts[pts.length - 1], dir = end.clone().sub(pts[pts.length - 2]).normalize();
    const m = new THREE.Mesh(side < 0 ? BUCKLE : TONGUE, M.metal); m.position.copy(end).addScaledVector(dir, side < 0 ? 0.03 : 0.02); m.rotation.set(-Math.PI / 2, 0, Math.atan2(dir.x, -dir.z) * (1 - k)); m.castShadow = true; g.add(m);
    if (side < 0) { const l = new THREE.Mesh(LATCHPLATE, M.trim); l.position.copy(m.position); l.position.y += 0.006; l.rotation.copy(m.rotation); g.add(l); }
  }
  g.position.set(seatX(s.letter), 0, backZ[s.row]); return g;
}
function setBelt(k) { if (RIG.beltMesh) { RIG.group.remove(RIG.beltMesh); RIG.beltMesh.traverse((o) => { if (!o.isMesh) return; if (o.geometry.type === "BufferGeometry") o.geometry.dispose(); if (hiMat.has(o)) { hiMat.delete(o); o.material.dispose(); } }); } RIG.beltMesh = buildBelt(k); RIG.beltMesh.userData.ctl = "belt"; RIG.group.add(RIG.beltMesh); RIG.beltMesh.traverse((o) => { if (o.isMesh) { o.userData.ctl = "belt"; glowable(o); } }); renderer.shadowMap.needsUpdate = true; dirty = true; }

function rigDetach() {
  TW.clear();
  for (const d of RIG.det) d.restore(); RIG.det = [];
  while (RIG.group.children.length) RIG.group.remove(RIG.group.children[0]);
  READ_SPOT.intensity = 0; RIG.light = null;
  hiMat.clear(); RIG.id = null; RIG.meshes = {}; RIG.pivots = {}; hideHotspots(); renderControls();
}
function rigAttach(id) {
  rigDetach(); const s = SEATS[id]; RIG.id = id; const ahead = s.row > 1 ? seatOf(s.row - 1, s.letter) : null;
  // own seat: belt, back (for recline); armrests may belong to the neighbour's part list
  const arms = armrestsFor(id);
  const add = (owner, parts) => { const d = detachSeatParts(owner, parts); RIG.det.push(d); for (const m of d.meshes) RIG.group.add(m); return d.meshes; };
  add(id, ["belt"]).forEach((m) => { m.visible = false; }); // replaced by the procedural belt
  const back = add(id, ["back", "tray"]);
  RIG.meshes.back = back;
  RIG.sup = { shade: s.position === "window", tray: !!ahead, light: true, belt: true, recline: true, armL: arms[0].raisable, armR: arms[1].raisable };
  RIG.why = { shade: "Only the window seat controls the shade.", tray: "Row 1 faces the bulkhead; its tray folds out of the armrest (not modelled).", armL: arms[0].why, armR: arms[1].why };
  // armrests: the moving parts rotate about the hinge boss; post and boss stay put
  arms.forEach((a, k) => {
    const ms = add(a.owner, [a.part]), mov = ms.filter((m) => m.geometry === P.arm || m.geometry === P.armPad || m.geometry === P.btn);
    const o = SEATS[a.owner], ax = a.part === "armL" ? -SW / 2 + 0.005 : SW / 2 - 0.005, piv = new THREE.Vector3(seatX(o.letter) + ax, 0.58, backZ[o.row] - 0.03);
    const key = k === 0 ? "armL" : "armR"; RIG.pivots[key] = { rot: pivotRot(mov, piv, new THREE.Vector3(1, 0, 0)), anchor: new THREE.Vector3(piv.x, 0.655, piv.z - 0.32), btn: new THREE.Vector3(piv.x, 0.64, piv.z - 0.36) };
    mov.forEach((m) => { m.userData.ctl = key; glowable(m); });
  });
  // tray on the seat ahead: tray swings down about its lower edge; the turn-button latch rotates first
  if (ahead) {
    const ms = add(ahead.id, ["tray"]), tray = ms.filter((m) => m.geometry === P.tray), latch = ms.filter((m) => m.geometry === P.latch);
    const bm = new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().makeTranslation(seatX(ahead.letter), 0, backZ[ahead.row]), new THREE.Matrix4().compose(new THREE.Vector3(0, PIVOT_Y, PIVOT_Z), new THREE.Quaternion().setFromEuler(new THREE.Euler(reclineA(ahead), 0, 0)), new THREE.Vector3(1, 1, 1)));
    const yt = 0.6 * BH, piv = new THREE.Vector3(0, yt - 0.122, shellZ(0.6) + 0.012).applyMatrix4(bm), lc = new THREE.Vector3(0, yt + 0.155, shellZ(0.8) + 0.006).applyMatrix4(bm);
    RIG.pivots.tray = { rot: pivotRot(tray, piv, new THREE.Vector3(1, 0, 0)), latch: pivotRot(latch, lc, new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(reclineA(ahead), 0, 0)))), open: Math.PI / 2 - (reclineA(ahead) - 0.03), anchor: new THREE.Vector3(0, yt, shellZ(0.6) + 0.04).applyMatrix4(bm) };
    tray.concat(latch).forEach((m) => { m.userData.ctl = "tray"; glowable(m); });
  }
  // recline: the back rotates about its pivot; bounded by the row's recline (limited rows move less)
  { const piv = new THREE.Vector3(seatX(s.letter), PIVOT_Y, backZ[s.row] + PIVOT_Z); RIG.pivots.recline = { rot: pivotRot(back, piv, new THREE.Vector3(1, 0, 0)), max: s.recline === "limited" ? 0.07 : 0.2 }; }
  // reading light: a lamp overlay plus a narrow spot onto the seat
  { const lp = lampPos(s), lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.0175, 0.0175, 0.004, 24), M.ledOff.clone()); lamp.position.copy(lp).add(new THREE.Vector3(0, -0.003, 0)); lamp.userData.ctl = "light"; RIG.group.add(lamp); RIG.meshes.lamp = lamp; glowable(lamp);
    const sp = READ_SPOT; sp.intensity = 0; sp.position.copy(lp).add(new THREE.Vector3(0, -0.02, 0)); sp.target.position.set(seatX(s.letter), 0.55, backZ[s.row] - 0.32); sp.target.updateMatrixWorld(); RIG.light = sp; RIG.pivots.light = { anchor: lp.clone() }; }
  // shade: the existing per-window shade
  if (RIG.sup.shade) { const sh = nearestShade(s); RIG.shade = sh; sh.sm.userData.ctl = "shade"; sh.lip.userData.ctl = "shade"; RIG.pivots.shade = { get anchor() { return new THREE.Vector3().setFromMatrixPosition(sh.lip.matrixWorld); } }; }
  // belt
  RIG.st = { shade: RIG.sup.shade ? (RIG.shade.sm.scale.y > 0.5 ? "down" : "up") : null, tray: false, armL: false, armR: false, light: false, belt: 1, recline: 0 };
  setBelt(1); RIG.pivots.belt = { anchor: new THREE.Vector3(seatX(s.letter), 0.49, backZ[s.row] - 0.18) };
  RIG.pivots.reclineBtn = RIG.pivots.armR ? RIG.pivots.armR : RIG.pivots.armL;
  renderer.shadowMap.needsUpdate = true; dirty = true; renderControls();
}

/* ---------- actions ---------- */
const LABEL = { shade: "Window shade", tray: "Tray table", armL: "Left armrest", armR: "Right armrest", light: "Reading light", belt: "Seatbelt", recline: "Recline preview", exit: "Try getting out" };
function stateText(k) { const st = RIG.st; return k === "shade" ? (st.shade === "down" ? "Closed" : "Open") : k === "tray" ? (st.tray ? "Down" : "Stowed") : k === "armL" || k === "armR" ? (st[k] ? "Raised" : "Down") : k === "light" ? (st.light ? "On" : "Off") : k === "belt" ? (st.belt ? "Fastened" : "Unfastened") : k === "recline" ? (view === "R" ? "Previewing" : "Upright") : ""; }
function act(k) {
  if (!RIG.id) return; if (k !== "exit" && k !== "recline" && !RIG.sup[k]) { ui.toast(RIG.why[k] || "Not available on this seat"); return; }
  RIG.tried.add(k); sfx(k);
  if (k === "shade") { const sh = RIG.shade, from = sh.sm.scale.y, to = from > 0.5 ? 0.02 : 1; RIG.st.shade = to > 0.5 ? "down" : "up"; TW.add(700, (e) => { sh.set(from + (to - from) * e); renderer.shadowMap.needsUpdate = true; dirty = true; }); }
  else if (k === "tray") { const p = RIG.pivots.tray, open = !RIG.st.tray; RIG.st.tray = open;
    if (open) TW.add(260, (e) => p.latch(e * Math.PI / 2), () => TW.add(820, (e) => p.rot(e * p.open)));
    else TW.add(820, (e) => p.rot((1 - e) * p.open), () => TW.add(260, (e) => p.latch((1 - e) * Math.PI / 2))); }
  else if (k === "armL" || k === "armR") { const p = RIG.pivots[k], up = !RIG.st[k]; RIG.st[k] = up; TW.add(650, (e) => p.rot((up ? e : 1 - e) * 1.52)); }
  else if (k === "light") { RIG.st.light = !RIG.st.light; const on = RIG.st.light; RIG.meshes.lamp.material.emissive.setRGB(on ? 1.8 : 0, on ? 1.6 : 0, on ? 1.25 : 0); TW.add(180, (e) => { RIG.light.intensity = (on ? e : 1 - e) * 2.2; dirty = true; }); }
  else if (k === "belt") { const to = RIG.st.belt ? 0 : 1, from = RIG.st.belt; RIG.st.belt = to; TW.add(600, (e) => setBelt(from + (to - from) * e)); }
  else if (k === "recline") { reclinePreview(); }
  else if (k === "exit") { if (window.startExitDemo) startExitDemo(); else loadModule("people").then(() => startExitDemo()); }
  renderControls(); renderTry();
}

/* recline preview: step into the aisle behind the seat, recline it within its range, show the change in space behind */
let reclineBusy = false;
function reclinePreview() {
  if (reclineBusy || !RIG.id) return; reclineBusy = true; const s = SEATS[RIG.id], p = RIG.pivots.recline, side = s.letter <= "C" ? -1 : 1, behind = SEATS[(s.row + 1) + s.letter];
  const from = camera.position.clone(); FREECAM.pos.copy(from); FREECAM.quat.copy(camera.quaternion); const prevView = view; view = "R"; ui.sync();
  const zb = backZ[s.row], pos = new THREE.Vector3(side * 0.2, 1.42, zb + 1.05), look = new THREE.Vector3(seatX(s.letter) * 0.85, 0.7, zb + 0.05);
  const m = behindSpace(s, p.max);
  const info = byId("reclineInfo");
  info.innerHTML = behind ? `<b>Recline preview · ${escH(s.id)}</b><span>Effect on ${escH(behind.id)} behind, in this model:</span><span>Modelled space at knee height: ${m.knee} → <b>${m.kneeAfter} cm</b></span><span>Tray table and screen move <b>${m.trayMove} cm</b> closer; top of the seat back <b>${m.topMove} cm</b>.</span><span class="fine">${s.recline === "limited" ? "Limited recline in this row." : "Full recline for this layout."} Illustrative geometry, not a measured seat.</span><button type="button" id="reclineDone">Done</button>`
    : `<b>Recline preview · ${escH(s.id)}</b><span>Last row: there is no seat behind, only the rear wall.</span><span class="fine">${s.recline === "limited" ? "Limited recline in this row." : ""}</span><button type="button" id="reclineDone">Done</button>`;
  info.hidden = false;
  const finish = () => { if (!reclineBusy) return; TW.add(700, (e) => p.rot((1 - e) * p.max), () => { camTo(from, from.clone().add(dirFrom(yaw, pitch)), 900, () => { view = prevView === "R" ? "F" : prevView; reclineBusy = false; ui.sync(); dirty = true; }); }); info.hidden = true; };
  byId("reclineDone").onclick = finish; byId("reclineDone").focus({ preventScroll: true }); RIG.finishRecline = finish;
  camTo(pos, look, 1100, () => TW.add(1300, (e) => p.rot(e * p.max)));
}
/* How far this seat back moves toward the passenger behind when reclined further by `extra` radians, at a given height,
   using the same pivot and shell profile as the 3D model (cabin geometry), plus knee space behind before/after. */
function zRear(s, h, ang) { const t = Math.max(0, Math.min(1, (h - PIVOT_Y) / BH)); return new THREE.Vector3(0, h - PIVOT_Y, shellZ(t)).applyAxisAngle(new THREE.Vector3(1, 0, 0), ang).z; }
function behindSpace(s, extra) {
  const a0 = reclineA(s), shift = (h) => zRear(s, h, a0 + extra) - zRear(s, h, a0);
  const ks = s.row < 30 ? kneeSpace(s.row + 1) : null;
  return { knee: ks ? Math.round(ks.d * 100) : null, kneeAfter: ks ? Math.round((ks.d - shift(KNEE_Y)) * 100) : null, trayMove: Math.round(shift(0.86) * 100), topMove: Math.round(shift(PIVOT_Y + BH - 0.02) * 100) };
}

/* ---------- hover / focus cue in 3D ---------- */
let hoverCtl = null;
function setHover(k) { if (k === hoverCtl) return; hoverCtl = k; for (const [m, mat] of hiMat) { const on = m.userData.ctl === k; mat.emissive.setRGB(on ? 0.32 : 0, on ? 0.2 : 0, on ? 0.05 : 0); if (m.userData.ctl === "light" && RIG.st.light) mat.emissive.setRGB(1.8, 1.6, 1.25); }
  if (RIG.shade) { const on = k === "shade"; RIG.shade.sm.material = on ? SHADE_HI : M.shade; } dirty = true; }
const SHADE_HI = M.shade.clone(); SHADE_HI.emissive = new THREE.Color(0.3, 0.19, 0.05);
const ray2 = new THREE.Raycaster(), ndc2 = new THREE.Vector2();
function pickCtl(ev) { const r = canvas.getBoundingClientRect(); ndc2.set((ev.clientX - r.left) / r.width * 2 - 1, -(ev.clientY - r.top) / r.height * 2 + 1); ray2.setFromCamera(ndc2, camera);
  const objs = []; RIG.group.traverse((o) => { if (o.isMesh && o.userData.ctl) objs.push(o); }); if (RIG.shade) objs.push(RIG.shade.sm);
  // detached meshes use matrixAutoUpdate=false with a world matrix; raycast needs matrixWorld = matrix
  for (const o of objs) if (!o.matrixAutoUpdate) o.matrixWorld.copy(o.matrix);
  const hit = ray2.intersectObjects(objs, false)[0]; return hit ? (hit.object.userData.ctl || (hit.object === (RIG.shade && RIG.shade.sm) ? "shade" : null)) : null; }
const SEATVIEWS = ["F", "W", "A", "L"];
canvas.addEventListener("pointermove", (ev) => { if (!RIG.id || !SEATVIEWS.includes(view) || ev.buttons) return; const k = pickCtl(ev); setHover(k); if (k) canvas.style.cursor = "pointer"; else if (canvas.style.cursor === "pointer") canvas.style.cursor = "grab"; });
canvas.addEventListener("pointerup", (ev) => { if (!RIG.id || !SEATVIEWS.includes(view)) return; if (ev.pointerType === "mouse" && ev.button !== 0) return; const k = pickCtl(ev); if (k && !window.__dragMoved) act(k); window.__dragMoved = false; });

/* ---------- on-screen hotspots (subtle dots, label only on hover/focus) ---------- */
const HS = document.getElementById("hotspots");
const HS_KEYS = ["shade", "tray", "armL", "armR", "light", "belt"];
function hideHotspots() { if (HS) HS.querySelectorAll("button").forEach((b) => { b.hidden = true; }); }
function placeHotspots() {
  if (!HS) return; const show = RIG.id && SEATVIEWS.includes(view) && !TW.list.length;
  for (const k of HS_KEYS) {
    let b = HS.querySelector(`[data-k="${k}"]`); if (!b) { b = document.createElement("button"); b.type = "button"; b.dataset.k = k; b.className = "hs"; b.innerHTML = "<i></i><span></span>"; b.onclick = () => act(k); b.onmouseenter = b.onfocus = () => setHover(k); b.onmouseleave = b.onblur = () => setHover(null); HS.append(b); }
    const p = RIG.pivots[k]; if (!show || !p || !RIG.sup[k] || (k === "light" && view === "L")) { b.hidden = true; continue; }
    const v = (p.anchor || p.btn).clone().project(camera); const vis = v.z < 1 && Math.abs(v.x) < 0.94 && Math.abs(v.y) < 0.9; b.hidden = !vis; if (!vis) continue;
    const r = canvas.getBoundingClientRect(); b.style.transform = `translate(${(v.x + 1) / 2 * r.width}px,${(1 - v.y) / 2 * r.height}px) translate(-50%,-50%)`;
    const t = `${LABEL[k]}: ${stateText(k)}`; b.setAttribute("aria-label", `${t}. Press to ${k === "belt" ? (RIG.st.belt ? "unfasten" : "fasten") : "change"}.`); b.querySelector("span").textContent = t; b.setAttribute("aria-pressed", String(k === "shade" ? RIG.st.shade === "up" : !!RIG.st[k]));
  }
}
FRAME_HOOKS.push(() => { placeHotspots(); return false; });

/* ---------- toolbar (keyboard and screen-reader equivalent of every hotspot) ---------- */
const CTRL_KEYS = [["shade", "S"], ["tray", "T"], ["armL", "["], ["armR", "]"], ["light", "L"], ["belt", "B"], ["recline", "R"], ["exit", "G"]];
function renderControls() {
  const bar = byId("ctrlBar"); if (!bar) return; const on = !!RIG.id && (SEATVIEWS.includes(view) || view === "R"); bar.hidden = !on; if (!on) return;
  bar.innerHTML = CTRL_KEYS.map(([k, key]) => { const sup = k === "recline" || k === "exit" || RIG.sup[k]; const st = k === "exit" ? "" : stateText(k);
    return `<button type="button" data-k="${k}" ${sup ? "" : `aria-disabled="true" title="${escH(RIG.why[k] || "")}"`} aria-pressed="${k === "exit" || k === "recline" ? "false" : String(k === "shade" ? RIG.st.shade === "up" : !!RIG.st[k])}" aria-keyshortcuts="${key}"><b>${LABEL[k].replace("Left armrest", "Armrest ◂").replace("Right armrest", "Armrest ▸")}</b>${st ? `<span>${st}</span>` : ""}<kbd>${key}</kbd></button>`; }).join("");
  bar.querySelectorAll("button").forEach((b) => { b.onclick = () => act(b.dataset.k); });
}
window.addEventListener("keydown", (ev) => {
  if (ev.target.closest("input,textarea,select") || ev.metaKey || ev.ctrlKey || ev.altKey || !RIG.id) return;
  if (view === "R" && ev.key === "Escape") { ev.stopImmediatePropagation(); RIG.finishRecline && RIG.finishRecline(); return; }
  if (!SEATVIEWS.includes(view)) return; const hit = CTRL_KEYS.find(([, key]) => key.toLowerCase() === ev.key.toLowerCase()); if (hit) { ev.preventDefault(); act(hit[0]); }
}, true);

/* ---------- "Things to try" (dismissible; remembered per browser) ---------- */
const TRY = [["shade", "Raise or lower the window shade"], ["tray", "Open the tray table"], ["arm", "Lift an armrest"], ["light", "Switch on the reading light"], ["belt", "Unfasten the seatbelt"], ["recline", "Preview the recline"], ["exit", "Try getting out to the aisle"]];
let tryOff = false; try { tryOff = localStorage.getItem("ss-try-off") === "1"; } catch (e) { /* storage unavailable */ }
function renderTry() {
  const el = byId("tryGuide"); if (!el) return; const on = !tryOff && !!RIG.id && SEATVIEWS.includes(view); el.hidden = !on; if (!on) return;
  const done = (k) => k === "arm" ? RIG.tried.has("armL") || RIG.tried.has("armR") : RIG.tried.has(k);
  el.querySelector("ul").innerHTML = TRY.map(([k, t]) => `<li class="${done(k) ? "done" : ""}">${done(k) ? "✓ " : ""}${t}</li>`).join("");
}
byId("tryClose") && (byId("tryClose").onclick = () => { tryOff = true; try { localStorage.setItem("ss-try-off", "1"); } catch (e) { /* ignore */ } renderTry(); });

/* ---------- opt-in sound (off by default; tiny synthesized clicks, no audio files) ---------- */
let SOUND = false, actx = null;
function sfx(k) { if (!SOUND) return; try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
  const f = { belt: 1900, tray: 380, armL: 300, armR: 300, light: 2600, shade: 220, recline: 160, exit: 520 }[k] || 600; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.08); o.type = k === "shade" ? "triangle" : "square";
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12); o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.14); } catch (e) { /* audio unavailable */ } }

/* hooks used by cabin3d.js */
window.onSeatEnter = (id) => { rigAttach(id); renderTry(); };
window.onSeatLeave = () => { if (RIG.finishRecline && view === "R") reclineBusy = false; rigDetach(); const i = byId("reclineInfo"); if (i) i.hidden = true; renderTry(); };
