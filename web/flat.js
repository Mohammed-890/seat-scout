/* Fallback when 3D rendering is unavailable (no WebGL, or ?no3d). Provides the few scene functions the interface
   calls, so seat details, the seat map, the assistant and "About this project" keep working without a canvas. */
"use strict";
const canvas = document.getElementById("scene"); canvas.hidden = true;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
let selGlow = 0, view = "AIR", selected = "14A", recs = [], focus = { seats: [], tone: null }, trans = null, dirty = false;
const ZC = 0, air = { zoom: 1, target: { set() {}, copy() {} } }, airGoal = { zoom: 1, target: { set() {}, copy() {} } };
const note = document.createElement("div"); note.className = "flat-note";
note.innerHTML = "<div><b>3D view unavailable on this device.</b><br>Seat details, the seat map and the assistant still work with the same data.</div>";
document.getElementById("viewer").append(note);
document.querySelector(".views").hidden = true;
const flatToast = (t) => typeof ui !== "undefined" && ui.toast(t);
function enterSeat(id) { selected = id; flatToast("Seat views need 3D (WebGL). Showing the seat on the map instead."); window.openTab && openTab("m"); typeof ui !== "undefined" && ui.sync(); }
function backToAircraft() {} function rotateTo() {} function skipTransition() {}
function refreshGuides() {} function applyHighlights() {} function aimSelLight() {} function applyFades() {} function placeSun() {} function loop() {}
setTimeout(() => { document.getElementById("loading").classList.add("done"); document.getElementById("cGo").hidden = true; }, 0);
