/**
 * Visual-inspection screenshots of fixed app states (dev tool, not a test).
 *   node scripts/shots.mjs <outDir> [state,state,...]
 * Starts the server in deterministic mode on PORT (default 8791), serves three.js from node_modules,
 * renders with SwiftShader (software WebGL), so timings here are NOT representative of a real GPU.
 */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";

const out = process.argv[2] || "shots";
const only = process.argv[3] ? process.argv[3].split(",") : null;
const PORT = process.env.PORT || "8791";
mkdirSync(out, { recursive: true });
const srv = spawn("npx", ["tsx", "src/server/index.ts"], { env: { ...process.env, SEAT_SCOUT_MODE: "deterministic", PORT }, stdio: "ignore" });
const base = `http://127.0.0.1:${PORT}/`;
for (let i = 0; i < 60; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }

const exe = process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function page(vw, vh, mobile = false) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, reducedMotion: "reduce" });
  await ctx.addInitScript(() => { try { localStorage.setItem("ss-quality", "high"); } catch {} }); // software rendering would otherwise switch to low quality
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("pageerror", String(e)));
  await p.route("https://cdn.jsdelivr.net/npm/three@0.147.0/**", (r) => r.fulfill({ body: readFileSync(`node_modules/three/${r.request().url().split("three@0.147.0/")[1]}`, "utf8"), contentType: "application/javascript" }));
  await p.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
  await p.route("https://fonts.gstatic.com/**", (r) => r.fulfill({ status: 404, body: "" }));
  await p.goto(base);
  await p.waitForSelector("#loading.done", { timeout: 300_000 });
  await p.addStyleTag({ content: "*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}" });
  await wait(1500);
  return p;
}
const settle = async (p, ms = 2500) => { await p.evaluate("typeof dirty!=='undefined'&&(dirty=true)"); await wait(ms); };
const seat = (id, m) => `ui.select('${id}');enterSeat('${id}','${m}');view`;
const desk = async (...ex) => { const p = await page(1440, 900); for (const e of ex) { await p.evaluate(e); await settle(p, 1200); } await settle(p, 2500); return p; };
const mob = async (...ex) => { const p = await page(390, 844, true); for (const e of ex) { await p.evaluate(e); await settle(p, 1200); } await settle(p, 2500); return p; };
const FAMILY = "We're two adults travelling with a five-year-old. Our total seat budget is £45. We want to sit together, and I'd prefer a window away from the wing.";
const STATES = {
  "desktop-aircraft": () => desk(),
  "desktop-recommend": () => desk(`(async()=>{qEl.value=${JSON.stringify(FAMILY)};send();await new Promise(r=>setTimeout(r,4000));return 1})()`),
  "desktop-seat-forward": () => desk(seat("14A", "F")),
  "desktop-seat-window": () => desk("loadModule('scenery').then(()=>1)", seat("14A", "W")),
  "desktop-legroom": () => desk(seat("17C", "L")),
  "desktop-about": () => desk("document.getElementById('aboutBtn').click();1"),
  "mobile-aircraft": () => mob(),
  "mobile-seat": () => mob(seat("21A", "W")),
  "mobile-assistant": () => mob(`(async()=>{setSheet('expanded');qEl.value=${JSON.stringify(FAMILY)};send();await new Promise(r=>setTimeout(r,4000));return 1})()`),
  "mobile-nogl": async () => { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" }); const p = await ctx.newPage(); await p.route("https://cdn.jsdelivr.net/npm/three@0.147.0/**", (r) => r.fulfill({ body: readFileSync(`node_modules/three/${r.request().url().split("three@0.147.0/")[1]}`, "utf8"), contentType: "application/javascript" })); await p.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" })); await p.goto(base + "?no3d"); await p.waitForSelector("#loading.done"); await wait(800); return p; },
};
for (const [name, fn] of Object.entries(STATES)) {
  if (only && !only.includes(name)) continue;
  const t0 = Date.now();
  try { const p = await fn(); for (const ex of (process.env.SHOT_EVAL || "").split(";;").filter(Boolean)) { await p.evaluate(ex); await settle(p, 3000); }
    await p.screenshot({ path: `${out}/${name}.png`, timeout: 300_000, animations: "disabled" }); await p.context().close(); console.log("ok", name, Date.now() - t0, "ms"); }
  catch (e) { console.log("FAIL", name, String(e).slice(0, 300)); }
}
await browser.close(); srv.kill();
