/* Passengers for Cabin Playground and "Try getting out". Loaded only when one of those is first used.
   No licensed human assets are available here, so these are stylised procedural figures: smooth lathe-turned limbs,
   a sculpted head with eyelids, brows and mouth for expressions, fabric-textured clothing. They are labelled as
   stylised, not realistic. Motion is keyframed poses blended with quaternion slerp, plus a damped, clamped spring for
   wobbles: no ragdoll, nothing can be launched, and every sequence ends in a defined resting pose.
   Movement paths avoid geometry by construction: aisle-side passengers swivel their legs into the aisle before
   standing; inner passengers slide seat-to-seat to the aisle seat first, so nobody stands up inside a 29-inch row. */
"use strict";
const PEOPLE = { list: [], on: false, mode: null, group: new THREE.Group(), bubbles: new Map() };
scene.add(PEOPLE.group);
const pEsc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- materials ---------- */
const SKIN = [[236, 192, 164], [205, 146, 108], [150, 98, 66], [226, 178, 120], [112, 72, 50]].map((c) => std({ color: new THREE.Color(`rgb(${c})`), roughness: 0.58, envMapIntensity: 0.35 }));
const cloth = (rgb, seed, rep = 6) => { const f = makeFabric(rgb, seed, rep); return std({ map: f.map, normalMap: f.normal, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.9, envMapIntensity: 0.3 }); };
const PM = { eyeW: std({ color: 0xf4f1ea, roughness: 0.25 }), iris: std({ color: 0x2a2018, roughness: 0.2 }), mouth: std({ color: 0x6b2a2a, roughness: 0.6 }), shoeW: std({ color: 0xe8e6e0, roughness: 0.6 }), shoeD: std({ color: 0x2c2420, roughness: 0.55 }), sole: std({ color: 0x9a9690, roughness: 0.8 }),
  phones: std({ color: 0x1c1f24, roughness: 0.4, metalness: 0.2 }), glass: std({ color: 0x15171b, roughness: 0.3, metalness: 0.6 }), cup: std({ color: 0xf2efe8, roughness: 0.4 }), coffee: std({ color: 0x3b2416, roughness: 0.2 }), snack: std({ color: 0xc7472f, roughness: 0.5 }), pillow: cloth([70, 92, 120], 51, 3) };
const HAIR = [0x2b211b, 0x6a4a2e, 0x111111, 0xb08a5a, 0x8c8c8c].map((c) => std({ color: c, roughness: 0.75 }));

/* ---------- geometry ---------- */
function limbGeo(r0, r1, len, seg = 20) { const pts = []; const N = 8;
  for (let i = 0; i <= N; i++) { const a = Math.PI / 2 * (1 - i / N); pts.push(new THREE.Vector2(r0 * Math.cos(a), r0 * Math.sin(a))); }
  for (let i = 1; i < 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(r0 + (r1 - r0) * t, -len * t)); }
  for (let i = 0; i <= N; i++) { const a = Math.PI / 2 * (i / N); pts.push(new THREE.Vector2(r1 * Math.cos(a), -len - r1 * Math.sin(a))); }
  return new THREE.LatheGeometry(pts, seg); }
function torsoGeo(prof, sz) { const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 32); g.scale(1, 1, sz); return g; }
const G = {
  abdomen: torsoGeo([[0.001, -0.02], [0.13, 0.0], [0.15, 0.06], [0.138, 0.16], [0.145, 0.26], [0.001, 0.27]], 0.7),
  chest: torsoGeo([[0.001, -0.04], [0.15, -0.03], [0.168, 0.06], [0.172, 0.14], [0.16, 0.2], [0.11, 0.235], [0.055, 0.25], [0.001, 0.25]], 0.66),
  hips: (() => { const g = new THREE.SphereGeometry(1, 28, 16); g.scale(0.165, 0.11, 0.12); return g; })(),
  thigh: limbGeo(0.074, 0.056, 0.4), shin: limbGeo(0.053, 0.04, 0.4), upper: limbGeo(0.047, 0.04, 0.27), fore: limbGeo(0.04, 0.031, 0.24),
  neck: limbGeo(0.046, 0.046, 0.07),
  head: (() => { const g = new THREE.SphereGeometry(0.104, 40, 28); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const jaw = y < 0 ? 1 - Math.min(0.2, -y * 1.6) : 1; x *= 0.9 * jaw; z *= y < 0 ? 0.98 : 1; y *= 1.12; p.setXYZ(i, x, y, z); } g.computeVertexNormals(); return g; })(),
  hand: (() => { const g = new THREE.SphereGeometry(1, 20, 12); g.scale(0.036, 0.05, 0.02); g.translate(0, -0.045, 0); return g; })(),
  thumb: limbGeo(0.011, 0.009, 0.035, 10),
  shoe: (() => { const g = new THREE.SphereGeometry(1, 24, 12); g.scale(0.047, 0.042, 0.125); g.translate(0, -0.012, -0.06); const p = g.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) < -0.02) p.setY(i, -0.02 - (p.getY(i) + 0.02) * 0.25); g.computeVertexNormals(); return g; })(),
  eye: new THREE.SphereGeometry(0.0165, 18, 12), iris: new THREE.SphereGeometry(0.0088, 14, 10), lid: new THREE.SphereGeometry(0.0178, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2),
  brow: (() => { const g = new THREE.CapsuleGeometry(0.0045, 0.026, 4, 8); g.rotateZ(Math.PI / 2); return g; })(),
  nose: (() => { const g = new THREE.SphereGeometry(1, 16, 10); g.scale(0.015, 0.024, 0.02); return g; })(),
  ear: (() => { const g = new THREE.SphereGeometry(1, 14, 10); g.scale(0.011, 0.028, 0.019); return g; })(),
  smile: new THREE.TorusGeometry(0.02, 0.0042, 8, 20, Math.PI), mouthO: (() => { const g = new THREE.SphereGeometry(1, 16, 10); g.scale(0.011, 0.014, 0.006); return g; })(),
  hairCap: new THREE.SphereGeometry(0.111, 36, 20, 0, Math.PI * 2, 0, Math.PI * 0.55), hairBack: (() => { const g = new THREE.SphereGeometry(0.108, 28, 16, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.4); g.scale(1, 1.25, 1); g.translate(0, -0.02, 0.012); return g; })(),
  bun: new THREE.SphereGeometry(0.045, 20, 14), beard: (() => { const g = new THREE.SphereGeometry(0.1, 28, 16, Math.PI * 0.15, Math.PI * 0.7, Math.PI * 0.55, Math.PI * 0.35); g.rotateY(Math.PI); g.scale(0.92, 1.12, 1); return g; })(),
  band: new THREE.TorusGeometry(0.118, 0.008, 8, 28, Math.PI), cupEar: (() => { const g = new THREE.CylinderGeometry(0.038, 0.04, 0.03, 24); g.rotateZ(Math.PI / 2); return g; })(),
  ring: new THREE.TorusGeometry(0.019, 0.0026, 8, 24), pillow: new THREE.TorusGeometry(0.085, 0.04, 14, 28, Math.PI * 1.55),
  cup: new THREE.CylinderGeometry(0.036, 0.029, 0.09, 20, 1, true), coffee: new THREE.CircleGeometry(0.034, 20), cupBase: new THREE.CircleGeometry(0.029, 20), snack: (() => { const g = new THREE.BoxGeometry(0.11, 0.15, 0.03, 4, 4, 2); const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) * (1 - Math.abs(p.getY(i)) * 3)); g.computeVertexNormals(); return g; })(),
};

/* ---------- a character ---------- */
const JOINTS = ["pelvis", "spine", "chest", "neck", "head", "shL", "elL", "haL", "shR", "elR", "haR", "hipL", "knL", "anL", "hipR", "knR", "anR"];
function makePerson(o) {
  const J = {}, root = new THREE.Group(); const j = (name, parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); (parent ? J[parent] : root).add(g); J[name] = g; return g; };
  const m = (geo, mat, parent, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const me = new THREE.Mesh(geo, mat); me.position.set(x, y, z); me.rotation.set(rx, ry, rz); me.receiveShadow = true; me.castShadow = false; J[parent].add(me); return me; };
  j("pelvis", null, 0, 0.95, 0); j("spine", "pelvis", 0, 0.06, 0); j("chest", "spine", 0, 0.25, 0); j("neck", "chest", 0, 0.23, 0); j("head", "neck", 0, 0.085, 0);
  for (const [s, x] of [["L", -1], ["R", 1]]) { j("sh" + s, "chest", x * 0.185, 0.17, 0); j("el" + s, "sh" + s, 0, -0.27, 0); j("ha" + s, "el" + s, 0, -0.245, 0);
    j("hip" + s, "pelvis", x * 0.092, -0.02, 0); j("kn" + s, "hip" + s, 0, -0.41, 0); j("an" + s, "kn" + s, 0, -0.41, 0); }
  const skin = SKIN[o.skin], top = cloth(o.top, o.seed), bottom = cloth(o.bottom, o.seed + 7, 5), hair = HAIR[o.hair];
  m(G.hips, bottom, "pelvis"); m(G.abdomen, top, "spine", 0, -0.04, 0); m(G.chest, top, "chest", 0, -0.02, 0); m(G.neck, skin, "neck", 0, 0.06, 0);
  const head = m(G.head, skin, "head", 0, 0.1, 0);
  for (const s of ["L", "R"]) { const x = s === "L" ? -1 : 1;
    m(G.upper, top, "sh" + s); m(G.fore, o.sleeves === "short" ? skin : top, "el" + s); m(G.hand, skin, "ha" + s); m(G.thumb, skin, "ha" + s, -x * 0.03, -0.02, -0.012, 0.3, 0, x * 0.6);
    m(G.thigh, bottom, "hip" + s); m(G.shin, bottom, "kn" + s); const sh = m(G.shoe, o.shoes === "light" ? PM.shoeW : PM.shoeD, "an" + s); sh.position.y = -0.03; }
  // face
  const F = { lids: [], brows: [], eyes: [] };
  for (const x of [-1, 1]) { const e = m(G.eye, PM.eyeW, "head", x * 0.036, 0.118, -0.088); F.eyes.push(e); const ir = m(G.iris, PM.iris, "head", x * 0.036, 0.118, -0.1); F.eyes.push(ir);
    const lid = m(G.lid, skin, "head", x * 0.036, 0.118, -0.088); F.lids.push(lid);
    const b = m(G.brow, hair, "head", x * 0.037, 0.148, -0.094); F.brows.push(b); m(G.ear, skin, "head", x * 0.094, 0.1, 0.005); }
  m(G.nose, skin, "head", 0, 0.092, -0.104);
  F.smile = m(G.smile, PM.mouth, "head", 0, 0.062, -0.092, 0, 0, Math.PI); F.mouthO = m(G.mouthO, PM.mouth, "head", 0, 0.058, -0.096); F.mouthO.visible = false;
  // hair styles
  const cap = m(G.hairCap, hair, "head", 0, 0.112, 0.006, -0.32); cap.scale.set(0.93, 1.1, 1.02);
  if (o.hairStyle === "long") m(G.hairBack, hair, "head", 0, 0.1, 0);
  if (o.hairStyle === "bun") m(G.bun, hair, "head", 0, 0.205, 0.07);
  if (o.beard) { const b = m(G.beard, hair, "head", 0, 0.098, -0.004); b.scale.set(0.95, 1, 0.98); }
  if (o.glasses) { for (const x of [-1, 1]) m(G.ring, PM.glass, "head", x * 0.037, 0.118, -0.108); const br = m(new THREE.CylinderGeometry(0.0022, 0.0022, 0.03, 6), PM.glass, "head", 0, 0.122, -0.11, 0, 0, Math.PI / 2); }
  const P_ = { root, J, F, o, head, props: {}, pose: {}, base: null, seq: [], wob: { a: 0, v: 0 }, tap: 0, blinkT: Math.random() * 3000, state: {}, talk: null };
  if (o.headphones) { const hp = new THREE.Group(); J.head.add(hp); hp.position.set(0, 0.1, 0.005); const band = new THREE.Mesh(G.band, PM.phones); band.rotation.set(0, Math.PI / 2, 0); hp.add(band);
    const cups = []; for (const x of [-1, 1]) { const c = new THREE.Mesh(G.cupEar, PM.phones); c.position.set(x * 0.112, -0.005, 0); hp.add(c); cups.push(c); } P_.props.phones = { hp, cups }; }
  if (o.pillow) { const pl = new THREE.Mesh(G.pillow, PM.pillow); pl.rotation.set(Math.PI / 2, 0, Math.PI * 0.72); pl.position.set(0, 0.02, 0.012); J.neck.add(pl); }
  if (o.snack) { const cup = new THREE.Group(); const c = new THREE.Mesh(G.cup, PM.cup); c.material.side = THREE.DoubleSide; cup.add(c); const cf = new THREE.Mesh(G.coffee, PM.coffee); cf.rotation.x = -Math.PI / 2; cf.position.y = 0.03; cup.add(cf); const cb = new THREE.Mesh(G.cupBase, PM.cup); cb.rotation.x = Math.PI / 2; cb.position.y = -0.045; cup.add(cb);
    J.haR.add(cup); cup.position.set(0.01, -0.07, -0.03); P_.props.cup = cup; const sn = new THREE.Mesh(G.snack, PM.snack); J.haL.add(sn); sn.position.set(0.0, -0.09, -0.02); sn.rotation.set(0.2, 0, 0.1); P_.props.snack = sn; }
  root.traverse((x) => { if (x.isMesh) x.userData.person = P_; });
  return P_;
}

/* ---------- poses (joint Euler angles in radians; root offset in seat-local metres) ---------- */
const SEATED = { pelvis: [0, 0, 0], spine: [0.15, 0, 0], chest: [0.02, 0, 0], neck: [-0.12, 0, 0], head: [0.02, 0, 0], shL: [0.28, 0, -0.06], elL: [1.25, 0, 0], haL: [0, 0, 0], shR: [0.28, 0, 0.06], elR: [1.25, 0, 0], haR: [0, 0, 0],
  hipL: [1.5, 0, -0.04], knL: [-1.42, 0, 0], anL: [0.1, 0, 0], hipR: [1.5, 0, 0.04], knR: [-1.42, 0, 0], anR: [0.1, 0, 0], _root: [0, -0.43, -0.15], _yaw: 0, face: "neutral" };
const pose = (over) => { const p = JSON.parse(JSON.stringify(SEATED)); for (const k in over) p[k] = over[k]; return p; };
function poseFor(kind, side) { // side: +1 if the aisle is at +x from this passenger, -1 otherwise
  const s = side;
  switch (kind) {
    case "sleeper": return pose({ spine: [0.2, 0, 0.06 * s], neck: [0.05, 0, 0.42 * s], head: [0.12, 0.12 * s, 0.1 * s], elL: [1.45, 0, 0], elR: [1.45, 0, 0], shL: [0.2, 0.25, -0.02], shR: [0.2, -0.25, 0.02], face: "asleep" });
    case "hog": return pose({ spine: [0.12, 0, -0.05 * s], [s > 0 ? "shL" : "shR"]: [0.35, 0, -0.42 * s], [s > 0 ? "elL" : "elR"]: [1.5, 0, 0], neck: [-0.1, -0.15 * s, 0], face: "content" });
    case "phones": return pose({ neck: [-0.08, 0, 0], face: "content" });
    case "snack": return pose({ shR: [0.55, 0, 0.1], elR: [1.25, 0, 0], shL: [0.4, 0, -0.08], elL: [1.65, 0, 0], neck: [0.02, 0, 0], face: "focused" });
    case "attentive": return pose({ neck: [-0.12, -0.55 * -s, 0], head: [0, -0.15 * -s, 0], face: "smile" });
    case "kneesAside": return pose({ hipL: [1.4, 0.55 * s, 0], hipR: [1.4, 0.55 * s, 0], knL: [-1.6, 0, 0], knR: [-1.6, 0, 0], spine: [0.22, 0.12 * s, 0], neck: [-0.1, -0.35 * -s, 0], face: "smile" });
    case "swivel": return pose({ _yaw: Math.PI / 2 * s, _root: [0.18 * s, -0.43, -0.12], hipL: [1.45, 0, 0], hipR: [1.45, 0, 0], neck: [-0.1, 0, 0], face: "smile" });
    case "rising": return pose({ _yaw: Math.PI / 2 * s, _root: [0.45 * s, -0.2, -0.16], spine: [-0.45, 0, 0], hipL: [1.0, 0, 0], hipR: [1.0, 0, 0], knL: [-1.2, 0, 0], knR: [-1.2, 0, 0], shL: [0.4, 0, 0], shR: [0.4, 0, 0], elL: [0.3, 0, 0], elR: [0.3, 0, 0], face: "smile" });
    case "standingAisle": return pose({ _yaw: Math.PI / 2 * s, _root: [0.62 * s, -0.02, -0.15], spine: [0, 0, 0], neck: [0, 0, 0], hipL: [0.05, 0, 0], hipR: [-0.05, 0, 0], knL: [-0.08, 0, 0], knR: [-0.05, 0, 0], anL: [0, 0, 0], anR: [0, 0, 0], shL: [0.05, 0, -0.08], shR: [0.05, 0, 0.08], elL: [0.25, 0, 0], elR: [0.25, 0, 0], face: "smile" });
    case "steppedBack": return pose({ _yaw: Math.PI, _root: [0.62 * s, -0.02, 0.62], spine: [0, 0, 0], neck: [0, 0, 0], hipL: [0.05, 0, 0], hipR: [-0.05, 0, 0], knL: [-0.08, 0, 0], knR: [-0.05, 0, 0], anL: [0, 0, 0], anR: [0, 0, 0], shL: [0.05, 0, -0.08], shR: [0.05, 0, 0.08], elL: [0.3, 0, 0], elR: [0.3, 0, 0], face: "smile" });
    case "slide": return pose({ _root: [0.48 * s, -0.43, -0.15], spine: [0.1, 0, 0], neck: [-0.1, 0, 0], face: "smile" });
    default: return pose({});
  }
}
const FACES = { neutral: { lid: 0.32, brow: 0, mouth: "smile", smile: 0.4 }, content: { lid: 0.18, brow: 0, mouth: "smile", smile: 0.9 }, smile: { lid: 0.28, brow: 0.003, mouth: "smile", smile: 1 }, focused: { lid: 0.05, brow: -0.004, mouth: "smile", smile: 0.1 },
  asleep: { lid: -1.55, brow: -0.002, mouth: "o", o: 0.55 }, surprised: { lid: 0.62, brow: 0.012, mouth: "o", o: 1.15 }, annoyed: { lid: -0.45, brow: -0.008, mouth: "smile", smile: -0.7 }, sleepy: { lid: -0.75, brow: -0.003, mouth: "smile", smile: 0.2 } };

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _ea = new THREE.Euler(), _eb = new THREE.Euler();
function applyPose(P, a, b, k) { // blend pose a → b by k
  for (const n of JOINTS) { const A = a[n], B = b[n]; _qa.setFromEuler(_ea.set(A[0], A[1], A[2])); _qb.setFromEuler(_eb.set(B[0], B[1], B[2])); P.J[n].quaternion.copy(_qa).slerp(_qb, k); }
  // root offsets are in seat space (not rotated by yaw); the body turns about its own pelvis
  const ra = a._root, rb = b._root, B = P.base || P.root.position;
  P.root.position.set(B.x + ra[0] + (rb[0] - ra[0]) * k, 0, B.z + ra[2] + (rb[2] - ra[2]) * k); P.J.pelvis.position.set(0, 0.95 + ra[1] + (rb[1] - ra[1]) * k, 0);
  P.root.rotation.y = a._yaw + (b._yaw - a._yaw) * k;
  const fa = FACES[a.face] || FACES.neutral, fb = FACES[k < 0.5 ? a.face : b.face] || FACES.neutral; P.faceNow = k < 0.5 ? a.face : b.face; P.lidBase = fa.lid + (FACES[b.face].lid - fa.lid) * k;
}
function setFace(P, name) { const f = FACES[name] || FACES.neutral; P.F.brows.forEach((b) => { b.position.y = 0.148 + f.brow; }); P.F.smile.visible = f.mouth === "smile"; P.F.mouthO.visible = f.mouth === "o";
  if (f.mouth === "smile") { P.F.smile.scale.set(1, Math.abs(f.smile) * 0.9 + 0.1, 1); P.F.smile.rotation.z = f.smile >= 0 ? Math.PI : 0; P.F.smile.position.y = f.smile >= 0 ? 0.062 : 0.05; } else P.F.mouthO.scale.setScalar(f.o); }

/* sequences: list of [poseObject, durationMs]; play() blends from the current pose */
function play(P, steps, done) { P.seq = steps.map(([p, d, cb]) => ({ p, d: reduce ? 1 : d, cb })); P.seqDone = done || null; P.t0 = performance.now(); P.from = P.cur; }
function tickPerson(P, t, dt) {
  if (P.seq.length) { const s = P.seq[0]; const k = Math.min(1, (t - P.t0) / s.d), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; applyPose(P, P.from, s.p, e); setFace(P, P.faceNow);
    if (k >= 1) { P.cur = s.p; P.from = s.p; P.seq.shift(); P.t0 = t; s.cb && s.cb(); if (!P.seq.length && P.seqDone) { const d = P.seqDone; P.seqDone = null; d(); } } }
  else applyPose(P, P.cur, P.cur, 1); // re-apply the resting pose so the additive layers below never accumulate
  // idle layer: breathing, blinking, headphone nod (added on top of the blended pose)
  const br = Math.sin(t / (P.o.kind === "sleeper" && P.faceNow === "asleep" ? 900 : 650)) * 0.012; P.J.chest.rotation.x += br; P.J.chest.scale.set(1 + br * 0.4, 1, 1 + br * 0.8);
  if (P.o.kind === "phones" && P.state.phonesOn && !P.seq.length) P.J.head.rotation.x += Math.sin(t / 260) * 0.05;
  P.blinkT -= dt; let lid = P.lidBase ?? 0.3; if (P.blinkT < 0 && P.faceNow !== "asleep") { lid = -1.5; if (P.blinkT < -120) P.blinkT = 2200 + Math.random() * 2800; }
  P.F.lids.forEach((l) => { l.rotation.x = lid; });
  // bounded wobble spring (from a playful shove): angle clamped, critically-ish damped
  const w = P.wob; if (Math.abs(w.a) > 1e-4 || Math.abs(w.v) > 1e-4) { const k = 70, c = 6.5, h = Math.min(dt, 40) / 1000; w.v += (-k * w.a - c * w.v) * h; w.a = Math.max(-0.2, Math.min(0.2, w.a + w.v * h)); }
  P.J.spine.rotation.z += w.a; P.J.neck.rotation.z -= w.a * 0.6; P.J.shL.rotation.z -= w.a * 1.4; P.J.shR.rotation.z -= w.a * 1.4;
  if (P.tap > 0) { P.tap = Math.max(0, P.tap - dt / 700); const e = Math.sin(Math.min(1, P.tap) * Math.PI) * 0.4; P.J.head.rotation.y += e * P.tapDir; P.J.head.rotation.z += e * 0.25 * P.tapDir; }
  if (P.props.cup) P.props.cup.rotation.z = Math.max(-0.18, Math.min(0.18, -P.J.elR.rotation.x * 0 + w.a * 1.5 + (P.state.wobbleCup ? Math.sin(t / 90) * 0.06 : 0)));
}

/* ---------- placement on the shared cabin dataset ---------- */
const CAST = [
  { name: "Sam", kind: "sleeper", skin: 0, top: [72, 88, 118], bottom: [58, 62, 74], hair: 1, hairStyle: "short", shoes: "light", seed: 61, pillow: true, beard: true },
  { name: "Priya", kind: "hog", skin: 1, top: [176, 132, 58], bottom: [40, 46, 64], hair: 2, hairStyle: "bun", shoes: "dark", seed: 62, glasses: true },
  { name: "Kwame", kind: "phones", skin: 4, top: [126, 44, 52], bottom: [64, 74, 98], hair: 2, hairStyle: "short", shoes: "light", seed: 63, headphones: true },
  { name: "Ana", kind: "snack", skin: 3, top: [76, 110, 92], bottom: [190, 176, 150], hair: 3, hairStyle: "long", shoes: "dark", seed: 64, snack: true, sleeves: "short" },
];
function aisleSideOf(letter) { return letter <= "C" ? 1 : -1; } // the aisle is at +x from A/B/C and at -x from D/E/F
function seatRoot(id) { const s = SEATS[id]; return new THREE.Vector3(seatX(s.letter), 0, backZ[s.row]); }
function between(id) { const s = SEATS[id]; const order = s.letter <= "C" ? ["A", "B", "C"] : ["F", "E", "D"]; const i = order.indexOf(s.letter); return order.slice(i + 1).map((l) => s.row + l); } // seats between you and the aisle, nearest first
function clearPeople() { for (const P of PEOPLE.list) PEOPLE.group.remove(P.root); PEOPLE.list = []; for (const el of PEOPLE.bubbles.values()) el.remove(); PEOPLE.bubbles.clear(); dirty = true; }
function placePerson(o, id, kind) { const P = makePerson({ ...o, kind }); P.seat = id; P.side = aisleSideOf(SEATS[id].letter); P.base = seatRoot(id); P.root.position.copy(P.base); PEOPLE.group.add(P.root);
  P.rest = poseFor(kind, P.side); P.cur = P.rest; P.from = P.rest; applyPose(P, P.rest, P.rest, 1); setFace(P, P.rest.face); P.state = { phonesOn: kind === "phones", asked: 0, wobbleCup: false }; PEOPLE.list.push(P); return P; }
/* Playground: fictional passengers around your seat (they do not change availability). Aisle demo without
   Playground: only seats the demo snapshot marks as taken get a (neutral) passenger. */
function populate(mode) {
  clearPeople(); const me = selected, s = SEATS[me]; if (!s) return;
  const inner = between(me);
  if (mode === "playground") {
    const kinds = inner.length === 2 ? [["hog", 1], ["sleeper", 0]] : inner.length === 1 ? [["sleeper", 0]] : [];
    inner.forEach((id, i) => placePerson(CAST[kinds[i][1]], id, kinds[i][0]));
    const other = s.letter <= "C" ? ["A", "B", "C"] : ["F", "E", "D"]; const outer = other.slice(0, other.indexOf(s.letter)).map((l) => s.row + l).reverse();
    if (outer[0]) placePerson(CAST[2], outer[0], "phones");
    const across = s.row + (s.letter <= "C" ? "D" : "C"); placePerson(CAST[3], across, "snack");
  } else {
    inner.filter((id) => SEATS[id].taken).forEach((id, i) => placePerson(CAST[i === 0 ? 0 : 1], id, "neutral"));
  }
  PEOPLE.mode = mode; dirty = true; renderPlayPanel();
}

/* ---------- speech bubbles ---------- */
function say(P, text, ms = 2200) { let el = PEOPLE.bubbles.get(P); if (!el) { el = document.createElement("div"); el.className = "bubble"; el.setAttribute("role", "status"); document.getElementById("markers").append(el); PEOPLE.bubbles.set(P, el); }
  el.textContent = text; el.classList.add("on"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("on"), ms); }
const _hp = new THREE.Vector3();
function placeBubbles() { const r = canvas.getBoundingClientRect(); for (const [P, el] of PEOPLE.bubbles) { P.J.head.getWorldPosition(_hp); _hp.y += 0.27; const v = _hp.clone().project(camera); const vis = v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1;
  el.style.display = vis ? "" : "none"; el.style.transform = `translate(${(v.x + 1) / 2 * r.width}px,${(1 - v.y) / 2 * r.height}px) translate(-50%,-100%)`; } }

/* ---------- your hand for nudges and taps (first person, comes in from below the view) ---------- */
const HAND = (() => { const g = new THREE.Group(); const sl = new THREE.Mesh(limbGeo(0.042, 0.035, 0.3), cloth([38, 52, 86], 70)); sl.rotation.x = Math.PI / 2; sl.position.z = 0.3; g.add(sl); const h = new THREE.Mesh(G.hand, SKIN[1]); h.rotation.x = Math.PI / 2; h.scale.set(1.15, 1.15, 1.15); g.add(h); g.visible = false; scene.add(g); return g; })();
function reach(target, dur, hold, done) { const start = camera.position.clone().add(new THREE.Vector3(0, -0.35, 0)).add(dirFrom(yaw, pitch).multiplyScalar(0.1)); const end = target.clone(); HAND.visible = true;
  const look = (p) => { HAND.position.copy(p); HAND.lookAt(end.clone().add(end.clone().sub(start))); };
  TW.add(dur, (e) => { look(start.clone().lerp(end, e)); dirty = true; }, () => setTimeout(() => TW.add(dur, (e) => { look(end.clone().lerp(start, e)); dirty = true; }, () => { HAND.visible = false; dirty = true; done && done(); }), hold)); }

/* ---------- interactions ---------- */
function nearest() { const inner = between(selected); return PEOPLE.list.find((P) => P.seat === inner[0]) || PEOPLE.list.find((P) => Math.abs(SEATS[P.seat].row - SEATS[selected].row) === 0) || PEOPLE.list[0]; }
let targetP = null;
function target() { return (targetP && PEOPLE.list.includes(targetP)) ? targetP : nearest(); }
function wp(P, j, dy = 0) { const v = new THREE.Vector3(); P.J[j].getWorldPosition(v); v.y += dy; return v; }
const LINES = { nudge: ["Hm?", "Oh! Sorry.", "Was I leaning?"], shove: ["Whoa!", "Turbulence?!", "Hey—!"], tap: ["Rude! …I was dreaming about free upgrades.", "Was that the trolley?", "Ow. Dramatically."] };
let busyP = false;
function playAction(kind) {
  const P = target(); if (!P || busyP) return; busyP = true; const done = () => { busyP = false; renderPlayPanel(); };
  if (kind === "excuse") return excuseMe(P, done);
  if (kind === "nudge") { reach(wp(P, P.side > 0 ? "shL" : "shR", 0), 380, 120, () => {}); setTimeout(() => { P.wob.v += 0.6 * P.side; if (P.o.kind === "sleeper" && P.cur.face === "asleep") { play(P, [[poseFor("attentive", P.side), 600], [{ ...P.rest, face: "sleepy" }, 900]], () => { P.rest.face = "asleep"; play(P, [[P.rest, 1200]], done); }); say(P, "Mm… five more minutes.", 2000); }
      else if (P.o.kind === "hog") { P.rest = poseFor("phones", P.side); P.rest.face = "smile"; play(P, [[{ ...P.rest, face: "surprised" }, 450], [P.rest, 700]], done); say(P, "Oh! Sorry, all yours."); }
      else { play(P, [[{ ...P.cur, face: "surprised" }, 300], [P.rest, 700]], done); say(P, LINES.nudge[Math.floor(Math.random() * 3)]); } }, 380); }
  else if (kind === "shove") { reach(wp(P, P.side > 0 ? "shL" : "shR", 0), 300, 80); setTimeout(() => { P.wob.v += 2.6 * P.side; P.state.wobbleCup = true; play(P, [[{ ...P.cur, face: "surprised" }, 250], [{ ...P.cur, face: "surprised" }, 900], [P.rest, 600]], () => { P.state.wobbleCup = false; done(); }); say(P, LINES.shove[Math.floor(Math.random() * 3)]); }, 300); }
  else if (kind === "tap") { reach(wp(P, "head", 0.06), 300, 60); setTimeout(() => { P.tap = 1; P.tapDir = P.side; poof(wp(P, "head", 0.06)); play(P, [[{ ...P.cur, face: "surprised" }, 160], [{ ...P.cur, face: "surprised" }, 1100], [{ ...P.rest, face: P.rest.face === "asleep" ? "sleepy" : "annoyed" }, 500], [P.rest, 900]], done); say(P, LINES.tap[Math.floor(Math.random() * 3)], 2800); }, 300); }
}
/* "pow" sparkle for the cartoon tap: a short-lived sprite, no contact effects on the character */
const POOF_TEX = (() => { const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d"); g.translate(64, 64); g.fillStyle = "#ffd36b"; g.beginPath(); for (let i = 0; i < 16; i++) { const r = i % 2 ? 26 : 58, a = i / 16 * Math.PI * 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill(); g.fillStyle = "#fff6dc"; g.font = "800 30px Outfit, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("pat!", 0, 2); const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t; })();
function poof(p) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: POOF_TEX, transparent: true, depthTest: false })); s.position.copy(p); s.renderOrder = 40; scene.add(s); TW.add(650, (e) => { s.scale.setScalar(0.08 + e * 0.14); s.material.opacity = 1 - e * e; dirty = true; }, () => { scene.remove(s); s.material.dispose(); }); }

/* Excuse me: the passenger notices, then either swings their knees aside (pitch ≥ 32 in) or stands into the aisle */
function excuseMe(P, done, opts = {}) {
  const pitch = SEATS[P.seat].pitch, roomy = pitch >= 32 && !opts.mustStand;
  if (P.o.kind === "phones" && P.state.phonesOn && P.state.asked === 0) { P.state.asked = 1; say(P, "♪ …", 1600); setTimeout(() => done && done({ ignored: true }), 900); return; }
  const go = () => {
    if (P.o.kind === "phones") { P.state.phonesOn = false; P.props.phones.cups[P.side > 0 ? 0 : 1].position.y = 0.05; say(P, "Sorry! Headphones. Sure."); }
    else if (P.o.kind === "sleeper" && P.rest.face === "asleep") say(P, "Hm? Oh—of course.");
    else if (P.o.kind === "snack") say(P, "Hold on, rescuing my coffee…", 2400);
    else say(P, roomy ? "Sure, squeeze past." : "Of course.");
    if (roomy) { play(P, [[poseFor("attentive", P.side), 500], [poseFor("kneesAside", P.side), 800]], () => done && done({ moved: "knees" })); return; }
    const steps = [[poseFor("attentive", P.side), 450], [poseFor("swivel", P.side), 800], [poseFor("rising", P.side), 700], [poseFor("standingAisle", P.side), 600], [poseFor("steppedBack", P.side), 1100]];
    if (P.o.kind === "snack") steps.splice(1, 0, [{ ...poseFor("snack", P.side), shR: [0.9, 0, 0.1], elR: [1.4, 0, 0], face: "focused" }, 900]);
    play(P, steps, () => done && done({ moved: "stood" }));
  };
  if (P.o.kind === "sleeper" && P.rest.face === "asleep") { P.rest = { ...P.rest, face: "sleepy" }; play(P, [[{ ...poseFor("phones", P.side), face: "sleepy" }, 700]], go); } else go();
}
/* inner passenger: slide over to the aisle seat (already vacated), then stand into the aisle */
function slideThenStand(P, done) { const steps = [[poseFor("attentive", P.side), 400], [poseFor("slide", P.side), 900]];
  play(P, steps, () => { P.base.x += 0.48 * P.side; const r0 = { ...poseFor("attentive", P.side), _root: [0, -0.43, -0.15] }; P.cur = r0; P.from = r0; applyPose(P, r0, r0, 1); P.slid = true;
    play(P, [[poseFor("swivel", P.side), 700], [poseFor("rising", P.side), 700], [poseFor("standingAisle", P.side), 600], [{ ...poseFor("steppedBack", P.side), _root: [0.62 * P.side, -0.02, 0.62 + 0.55] }, 1100]], done); }); }
function resetPerson(P) { P.slid = false; P.base = seatRoot(P.seat); P.root.position.copy(P.base); P.rest = poseFor(P.o.kind, P.side);
  P.cur = P.rest; P.from = P.rest; P.seq = []; P.wob = { a: 0, v: 0 }; P.tap = 0; applyPose(P, P.rest, P.rest, 1); setFace(P, P.rest.face);
  if (P.props.phones) { P.state.phonesOn = true; P.state.asked = 0; P.props.phones.cups.forEach((c) => { c.position.y = -0.005; }); } }
function resetAll() { for (const P of PEOPLE.list) resetPerson(P); busyP = false; dirty = true; renderPlayPanel(); }

/* bounds check used by tests: every passenger is either in its own seat footprint or in the aisle, upright-ish */
function peopleCheck() { const out = []; for (const P of PEOPLE.list) { const p = new THREE.Vector3(); P.J.pelvis.getWorldPosition(p); const s = SEATS[P.seat], sx = seatX(s.letter), bz = backZ[s.row];
  const inSeatRow = Math.abs(p.z - (bz - 0.2)) < 0.7, inAisle = Math.abs(p.x) < AISLE / 2 + 0.05 && p.z > bz - 1.2 && p.z < bz + 2.2, inSeats = Math.abs(p.x) <= 1.95;
  if (!(inSeatRow || inAisle) || !inSeats || p.y < 0.2 || p.y > 1.2) out.push({ name: P.o.name, seat: P.seat, at: p.toArray().map((v) => Math.round(v * 100) / 100) });
  if (Math.abs(P.wob.a) > 0.2001) out.push({ name: P.o.name, wobble: P.wob.a }); } return out; }

/* ---------- frame hook ---------- */
FRAME_HOOKS.push((t, dt) => { if (!PEOPLE.list.length) return false; let active = false; for (const P of PEOPLE.list) { const was = P.seq.length || Math.abs(P.wob.v) > 1e-3 || P.tap > 0; tickPerson(P, t, dt); if (was) active = true; }
  placeBubbles(); const hasBubble = [...PEOPLE.bubbles.values()].some((e) => e.classList.contains("on")); return active || hasBubble || (PEOPLE.mode === "playground" && !reduce && !QUALITY.low); });

/* ---------- Playground panel ---------- */
function renderPlayPanel() { const el = document.getElementById("playPanel"); if (!el) return; const on = PEOPLE.mode === "playground" && ["F", "W", "A", "L"].includes(view); el.hidden = !on; if (!on) return;
  const T = target(); el.innerHTML = `<div class="pp-h"><b>Cabin Playground</b><span class="fine">Fictional, stylised passengers · availability unchanged</span></div>
   <label class="pp-t">Who: <select id="ppWho">${PEOPLE.list.map((P, i) => `<option value="${i}" ${P === T ? "selected" : ""}>${pEsc(P.o.name)} · ${pEsc(P.seat)}${P.o.kind === "sleeper" ? " (asleep)" : P.o.kind === "hog" ? " (armrest)" : P.o.kind === "phones" ? " (headphones)" : P.o.kind === "snack" ? " (snack)" : ""}</option>`).join("")}</select></label>
   <div class="pp-b"><button class="btn" data-p="excuse">“Excuse me”</button><button class="btn" data-p="nudge">Shoulder nudge</button><button class="btn" data-p="shove">Playful shove</button><button class="btn" data-p="tap">Cartoon cheek tap</button><button class="btn" data-p="reset">Reset</button></div>`;
  el.querySelector("#ppWho").onchange = (e) => { targetP = PEOPLE.list[Number(e.target.value)]; };
  el.querySelectorAll("[data-p]").forEach((b) => { b.disabled = false; b.onclick = () => { const k = b.dataset.p; if (k === "reset") resetAll(); else { if (busyP) return; playAction(k); } }; }); }
/* turn toward your neighbours so they are in view (they sit beside you, outside the forward view) */
function faceNeighbours() { if (["F", "W", "L"].includes(view) && between(selected).length) rotateTo("A"); }
function setPlayground(on) { PEOPLE.on = on; if (on) { if (["F", "W", "A", "L"].includes(view)) { populate("playground"); faceNeighbours(); } } else { clearPeople(); PEOPLE.mode = null; } renderPlayPanel(); dirty = true; }

/* ---------- "Try getting out" ---------- */
const EXIT = { running: false, steps: [], cancel: false };
function startExitDemo() {
  if (EXIT.running || !RIG.id) return; const me = selected, s = SEATS[me]; if (!["F", "W", "A", "L"].includes(view)) return;
  if (!PEOPLE.on) populate("exit"); else if (!PEOPLE.list.length) populate("playground");
  const inner = between(me), blockers = [...inner].reverse().map((id) => PEOPLE.list.find((P) => P.seat === id)).filter(Boolean), pitch = s.pitch, roomy = pitch >= 32;
  const trays = (RIG.st.tray ? 1 : 0); const side = aisleSideOf(s.letter);
  EXIT.running = true; EXIT.cancel = false; EXIT.me = me; const prevView = view; FREECAM.pos.copy(camera.position); FREECAM.quat.copy(camera.quaternion); view = "X"; ui.sync();
  const steps = []; if (RIG.st.tray) steps.push(["Fold your tray table", (n) => { act("tray"); setTimeout(n, 1200); }]);
  if (RIG.st.belt) steps.push(["Unfasten your seatbelt", (n) => { act("belt"); setTimeout(n, 700); }]);
  blockers.forEach((P, i) => { const first = i === 0;
    steps.push([`Ask ${P.o.name} (${P.seat}) to let you out`, (n) => { if (first || roomy) excuseMe(P, (r) => { if (r && r.ignored) { setTimeout(() => excuseMe(P, () => n()), 600); return; } n(); }, { mustStand: !roomy });
      else { say(P, "My turn, one sec."); slideThenStand(P, () => n()); } }]); });
  if (!blockers.length) steps.push([inner.length ? "The seats beside you are free in this snapshot" : "You're on the aisle: step straight out", (n) => setTimeout(n, 500)]);
  const zb = backZ[s.row], ex = seatX(s.letter);
  steps.push([roomy && blockers.length ? "Squeeze past their knees to the aisle" : "Move across the row to the aisle", (n) => { const crouch = new THREE.Vector3(ex, 1.3, zb - 0.5); camTo(crouch, crouch.clone().add(new THREE.Vector3(side, -0.25, -0.35)), 900, () => camTo(new THREE.Vector3(side * 0.06, 1.3, zb - 0.5), new THREE.Vector3(side * 1.2, 1.0, zb - 1.6), 1500, n)); }]);
  steps.push(["Stand up in the aisle", (n) => camTo(new THREE.Vector3(0, 1.6, zb - 0.45), new THREE.Vector3(0, 1.35, zb - 3.5), 1000, n)]);
  steps.push(["Look back at the route", (n) => camTo(new THREE.Vector3(-side * 0.1, 1.62, zb - 1.55), new THREE.Vector3(ex * 0.45, 0.85, zb + 0.35), 1200, n)]);
  EXIT.steps = steps.map(([t]) => ({ t, st: "todo" })); EXIT.summary = { people: blockers.length, standing: blockers.length && !roomy ? blockers.length : 0, trays, pitch, roomy, pos: s.position, me };
  renderExitPanel(); let i = 0;
  const next = () => { if (EXIT.cancel) return; if (i > 0) EXIT.steps[i - 1].st = "done"; if (i >= steps.length) { EXIT.running = false; renderExitPanel(true); return; } EXIT.steps[i].st = "now"; renderExitPanel(); const f = steps[i][1]; i++; f(next); };
  EXIT.prevView = prevView; next();
}
function stopExitDemo(reset = true) { EXIT.cancel = true; EXIT.running = false; TW.clear(); for (const P of PEOPLE.list) { P.seq = []; } if (reset) { if (PEOPLE.mode === "exit") clearPeople(); else resetAll(); }
  if (RIG.id) { if (!RIG.st.belt) act("belt"); } view = "F"; ui.sync(); dirty = true; const el = document.getElementById("exitPanel"); if (el) el.hidden = true; renderPlayPanel(); }
function skipExitDemo() { if (!EXIT.running && view !== "X") return; EXIT.cancel = true; TW.clear();
  const S = EXIT.summary; const inner = between(S.me);
  [...inner].reverse().map((id) => PEOPLE.list.find((P) => P.seat === id)).filter(Boolean).forEach((P, i) => { P.seq = []; P.seqDone = null; let end; // aisle side first
    if (S.roomy) end = poseFor("kneesAside", P.side);
    else if (i === 0) end = poseFor("steppedBack", P.side);
    else { P.base = seatRoot(P.seat); P.base.x += 0.48 * P.side; P.slid = true; end = { ...poseFor("steppedBack", P.side), _root: [0.62 * P.side, -0.02, 0.62 + 0.55 * i] }; }
    if (P.o.kind === "phones" && P.props.phones) { P.state.phonesOn = false; P.props.phones.cups[P.side > 0 ? 0 : 1].position.y = 0.05; }
    P.cur = end; P.from = end; applyPose(P, end, end, 1); setFace(P, end.face); });
  const s = SEATS[S.me], zb = backZ[s.row], sd = aisleSideOf(s.letter); FREECAM.pos.set(-sd * 0.1, 1.62, zb - 1.55); FREECAM.quat.copy(quatLook(FREECAM.pos, new THREE.Vector3(seatX(s.letter) * 0.45, 0.85, zb + 0.35))); EXIT.steps.forEach((x) => { x.st = "done"; }); EXIT.running = false; dirty = true; renderExitPanel(true); }
function renderExitPanel(finished) { const el = document.getElementById("exitPanel"); if (!el) return; el.hidden = false; const S = EXIT.summary;
  const trade = S.pos === "aisle" ? "Aisle seat: direct route, nobody has to move. You give up the window." : `${S.pos === "window" ? "Window seat: the view, but" : "Middle seat:"} ${S.people ? `${S.people} ${S.people > 1 ? "people" : "person"} had to move` : "nobody was seated beside you this time"} each time you get up.`;
  el.innerHTML = `<div class="ex-h"><b>Try getting out · ${pEsc(S.me)}</b><button class="icon" id="exClose" aria-label="Close and return to your seat">✕</button></div>
   <ol class="ex-steps">${EXIT.steps.map((x) => `<li class="${x.st}">${pEsc(x.t)}</li>`).join("")}</ol>
   <div class="ex-sum"><span><b>${S.people}</b> ${S.people === 1 ? "person" : "people"} to pass</span><span><b>${S.standing}</b> had to stand</span><span><b>${S.trays}</b> tray table${S.trays === 1 ? "" : "s"} to fold</span><span>Seat pitch: <b>${S.pitch} in / ${Math.round(S.pitch * 2.54)} cm</b>${S.people ? (S.roomy ? " (room to swing knees aside)" : " (too tight to pass seated passengers)") : ""}</span></div>
   <p class="ex-trade">${pEsc(trade)}</p><p class="fine">Illustrative sequence with ${PEOPLE.mode === "playground" ? "fictional Playground passengers" : "passengers only where the demo snapshot shows a taken seat"}; not an evacuation, timing or accessibility measure.</p>
   <div class="row"><button class="btn" id="exSkip" ${finished ? "disabled" : ""}>Skip to the end</button><button class="btn primary" id="exReset">${finished ? "Back to my seat" : "Reset"}</button></div>`;
  el.querySelector("#exClose").onclick = () => stopExitDemo(true); el.querySelector("#exSkip").onclick = skipExitDemo; el.querySelector("#exReset").onclick = () => stopExitDemo(true); }

window.startExitDemo = startExitDemo; window.stopExitDemo = stopExitDemo; window.setPlayground = setPlayground; window.peopleCheck = peopleCheck; window.PEOPLE = PEOPLE; window.playAction = playAction; window.resetAll = resetAll;
/* keep Playground passengers in sync with the seat you're in */
const _enter = window.onSeatEnter, _leave = window.onSeatLeave;
window.onSeatEnter = (id) => { _enter && _enter(id); if (PEOPLE.on) populate("playground"); };
window.onSeatLeave = () => { if (EXIT.running || view === "X") { EXIT.cancel = true; EXIT.running = false; const el = document.getElementById("exitPanel"); if (el) el.hidden = true; } _leave && _leave(); clearPeople(); PEOPLE.mode = null; renderPlayPanel(); };
if (window.onPeopleReady) window.onPeopleReady();
