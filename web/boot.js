/* Boot: choose the API (server or in-page preview), load the canonical data, define 3D globals, start the UI. */
"use strict";
(async function boot() {
  const embedded = window.__EMBEDDED__ || null;
  const api = embedded ? window.SeatCore.localApi(embedded) : window.SeatCore.httpApi();
  window.API = api;
  window.SAMPLE_TRACE = embedded ? embedded.sampleTrace : null;
  let info;
  try { info = await api.init(); }
  catch (e) { document.getElementById("loading").textContent = "Couldn't reach the Seat Scout server. Is `npm start` running?"; return; }
  window.MODEINFO = info;
  defineSeatGlobals(info.config, info.policy, info.takenSeats);
  const run = (code) => new Promise((resolve) => { const s = document.createElement("script"); s.textContent = code; document.body.append(s); resolve(); });
  const load = (src) => new Promise((resolve, reject) => { const s = document.createElement("script"); s.src = src; s.onload = resolve; s.onerror = reject; document.body.append(s); });
  if (embedded) { await run(document.getElementById("src-cabin3d").textContent); await run(document.getElementById("src-ui").textContent); }
  else { await load("/web/cabin3d.js"); await load("/web/ui.js"); fetch("/web/sample-trace.json").then((r) => r.json()).then((t) => { window.SAMPLE_TRACE = t; }).catch(() => {}); }
  if (api.ready) api.ready.then((m) => { window.MODEINFO = Object.assign({}, window.MODEINFO, m); window.setModePill && window.setModePill(); });
})();
