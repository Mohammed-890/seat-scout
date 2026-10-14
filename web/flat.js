/* Fallback when 3D rendering is unavailable (no WebGL, or ?no3d). Provides the few scene functions the interface
   calls, so the concierge, 2D seat map, comparison table and engineering view keep working without a canvas. */
"use strict";
const canvas = document.getElementById("scene"); canvas.hidden = true;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const app = document.getElementById("app");
let selGlow = 0;
let view = "AIR", selected = "14A", recs = [], cmp = { a: null, b: null }, seatView = "F", focus = { seats: [], tone: null }, trans = null, dirty = false, SOUND = false;
const QUALITY = { low: true }, FRAME_HOOKS = [], ZC = 0;
const air = { zoom: 1, target: { set() {}, copy() {} } }, airGoal = { zoom: 1, target: { set() {}, copy() {} } };
const PERF = { stats: () => ({ renderer: "none (3D unavailable)", quality: "n/a", pixelRatio: 0, frames: 0 }) };
const note = document.createElement("div"); note.className = "flat-note glass";
note.innerHTML = "<div><b>3D view unavailable on this device.</b><br>The 2D seat map, concierge, comparison and engineering view all still work with the same data.</div>";
app.prepend(note);
const flatToast = (t) => typeof ui !== "undefined" && ui.toast(t);
function enterSeat(id) { selected = id; flatToast("3D seat views need WebGL. Showing the seat on the map instead."); window.openTab && openTab("m"); typeof ui !== "undefined" && ui.sync(); }
function backToAircraft() {} function rotateTo() { flatToast("3D views need WebGL."); } function skipTransition() {}
function enterCompare(a, b) { cmp.a = a; cmp.b = b; window.openTab && openTab("x"); }
function cmpSetView() {} function refreshGuides() {} function applyHighlights() {} function aimSelLight() {} function applyFades() {} function placeSun() {}
function applyQuality() {} function sfx() {} function loop() {}
window.loadModule && (window.loadModule.flat = true);
setTimeout(() => { document.getElementById("loading").classList.add("done"); window.openTab && openTab("m"); }, 0);
