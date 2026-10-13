/** Builds artifact/seat-scout.html: a single-file preview for claude.ai with the same core, data and UI embedded. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { buildCore, recordSampleTrace, THREE_SCRIPTS } from "./build-web.js";
import { loadConfig, loadPolicy, loadSnapshot } from "../src/core/load-node.js";

await buildCore("artifact/core.tmp.js");
const evalLatest = existsSync("eval/results/latest.json") ? JSON.parse(readFileSync("eval/results/latest.json", "utf8")) : null;
const embedded = { config: loadConfig(), policy: loadPolicy(), snapshot: loadSnapshot(), evalLatest, sampleTrace: await recordSampleTrace() };
const esc = (s: string) => s.replace(/<\/script/gi, "<\\/script");
const html = `${readFileSync("web/shell.html", "utf8")}
${THREE_SCRIPTS.map((s) => `<script src="${s}"></script>`).join("\n")}
<script>${esc(readFileSync("artifact/core.tmp.js", "utf8"))}</script>
<script>${esc(readFileSync("web/globals.js", "utf8"))}</script>
<script>window.__EMBEDDED__=${esc(JSON.stringify(embedded))};</script>
<script type="text/plain" id="src-cabin3d">${esc(readFileSync("web/cabin3d.js", "utf8"))}</script>
<script type="text/plain" id="src-ui">${esc(readFileSync("web/ui.js", "utf8"))}</script>
<script>${esc(readFileSync("web/boot.js", "utf8"))}</script>
`;
mkdirSync("artifact", { recursive: true });
writeFileSync("artifact/seat-scout.html", html);
console.log(`artifact/seat-scout.html ${(html.length / 1024).toFixed(0)} KB`);
