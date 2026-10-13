/** Builds web/dist/core.js (shared core for the browser), web/sample-trace.json (a real recorded run) and web/index.html. */
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { loadDataset, loadSnapshot } from "../src/core/load-node.js";
import { Session } from "../src/app/session.js";
import { handleTurn } from "../src/app/turn.js";

export const THREE_SCRIPTS = ["build/three.min.js", "examples/js/environments/RoomEnvironment.js", "examples/js/lights/RectAreaLightUniformsLib.js", "examples/js/objects/Sky.js"]
  .map((p) => `https://cdn.jsdelivr.net/npm/three@0.147.0/${p}`);
export const DEMO_REQUEST = "We're two adults travelling with a five-year-old. Our total seat budget is £45. We want to sit together, and I'd prefer a window away from the wing.";

export async function buildCore(outfile = "web/dist/core.js") {
  mkdirSync("web/dist", { recursive: true });
  await build({ entryPoints: ["web/src/browser.ts"], bundle: true, format: "iife", platform: "browser", target: "es2020", outfile, minify: true, legalComments: "none" });
}
export async function recordSampleTrace() {
  const s = new Session("sample", loadDataset(), loadSnapshot());
  const r = await handleTurn(s, DEMO_REQUEST, null);
  return r.trace;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  await buildCore();
  writeFileSync("web/sample-trace.json", JSON.stringify(await recordSampleTrace(), null, 1));
  const shell = readFileSync("web/shell.html", "utf8");
  const html = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>\n${shell}\n${THREE_SCRIPTS.map((s) => `<script src="${s}"></script>`).join("\n")}\n<script src="/dist/core.js"></script>\n<script src="/web/globals.js"></script>\n<script src="/web/boot.js"></script>\n</body></html>\n`;
  writeFileSync("web/index.html", html);
  console.log("built web/dist/core.js, web/sample-trace.json, web/index.html");
}
