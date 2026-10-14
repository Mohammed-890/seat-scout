/* Boot: choose the API (server or in-page preview), load the canonical data, define 3D globals, start the UI.
   Modules: cabin3d + interact + ui load first; scenery loads right after the first frame; people (passengers)
   loads only when Cabin Playground or "Try getting out" is first used. */
"use strict";
(async function boot() {
  const embedded = window.__EMBEDDED__ || null;
  const api = embedded ? window.SeatCore.localApi(embedded) : window.SeatCore.httpApi();
  window.API = api;
  window.SAMPLE_TRACE = embedded ? embedded.sampleTrace : null;
  const loading = document.getElementById("loading");
  const fail = (msg) => { loading.classList.add("failed"); loading.textContent = msg; };
  let info;
  try { info = await api.init(); }
  catch (e) { fail("Couldn't reach the Seat Scout server. Is `npm start` running?"); return; }
  window.MODEINFO = info;
  defineSeatGlobals(info.config, info.policy, info.takenSeats);
  const loaded = {};
  window.loadModule = (name) => loaded[name] || (loaded[name] = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    if (embedded) { s.textContent = document.getElementById("src-" + name).textContent; document.body.append(s); resolve(); }
    else { s.src = `/web/${name}.js`; s.onload = () => resolve(); s.onerror = () => reject(new Error(`failed to load ${name}`)); document.body.append(s); }
  }));
  // 3D failure fallback: if WebGL can't start, the 2D seat map and concierge still work.
  const gl = (() => { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) { return false; } })();
  window.NO3D = !gl || /[?&]no3d\b/.test(location.search);
  try {
    if (window.NO3D) await window.loadModule("flat");
    else { await window.loadModule("cabin3d"); await window.loadModule("interact"); }
  } catch (e) { console.error(e); window.NO3D = true; await window.loadModule("flat"); }
  await window.loadModule("ui");
  if (!window.NO3D) (window.requestIdleCallback || setTimeout)(() => window.loadModule("scenery").then(() => { window.FRAME_HOOKS && FRAME_HOOKS.push((t, dt) => skyFrame(dt)); window.onSceneryReady && window.onSceneryReady(); }).catch((e) => console.error(e)));
  if (!embedded) fetch("/web/sample-trace.json").then((r) => r.json()).then((t) => { window.SAMPLE_TRACE = t; }).catch(() => {});
  if (api.ready) api.ready.then((m) => { window.MODEINFO = Object.assign({}, window.MODEINFO, m); window.setModePill && window.setModePill(); });
})();
