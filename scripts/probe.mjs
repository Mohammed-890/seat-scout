/** Dev probe: load the app, run expressions in order, print results.  node scripts/probe.mjs 'expr1' 'expr2' ... */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
const PORT = process.env.PORT || "8799", base = `http://127.0.0.1:${PORT}/${process.env.QS || ""}`;
const srv = spawn("npx", ["tsx", "src/server/index.ts"], { env: { ...process.env, SEAT_SCOUT_MODE: "deterministic", PORT }, stdio: "ignore" });
for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/`); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: Number(process.env.VW || 1440), height: Number(process.env.VH || 900) }, reducedMotion: process.env.RM || "reduce" });
const p = await ctx.newPage(); p.on("pageerror", (e) => console.log("pageerror", String(e), (e.stack || "").split("\n").slice(0, 6).join(" | "))); p.on("console", (m) => { if (m.type() === "error") console.log("console.error", m.text().slice(0, 300)); });
await p.route("https://cdn.jsdelivr.net/npm/three@0.147.0/**", (r) => r.fulfill({ body: readFileSync(`node_modules/three/${r.request().url().split("three@0.147.0/")[1]}`, "utf8"), contentType: "application/javascript" }));
await p.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
await p.goto(base); await p.waitForSelector("#loading.done", { timeout: 300000 });
for (const ex of process.argv.slice(2)) { if (ex.startsWith("wait:")) { await new Promise((r) => setTimeout(r, Number(ex.slice(5)))); continue; } if (ex.startsWith("shot:")) { await p.screenshot({ path: ex.slice(5), timeout: 300000 }); console.log("shot", ex.slice(5)); continue; }
  try { console.log(">", ex.slice(0, 80), "=>", JSON.stringify(await p.evaluate(ex)).slice(0, 1500)); } catch (e) { console.log(">", ex.slice(0, 80), "ERR", String(e).slice(0, 300)); } }
await browser.close(); srv.kill();
