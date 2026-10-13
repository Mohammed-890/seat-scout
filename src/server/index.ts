/**
 * Seat Scout HTTP server (Node built-ins only).
 * Trust boundary: the browser never sees the API key, raw model messages or other sessions.
 * Sessions are identified by a random HttpOnly cookie and checked on every request.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadConfig, loadPolicy, loadSnapshot, loadDataset } from "../core/load-node.js";
import { Session } from "../app/session.js";
import { handleTurn, simulateSeatTaken, selectSeats, type AgentRunner, type Pricing } from "../app/turn.js";
import { agentTurn } from "../agent/agent.js";
import { anthropicClient } from "./anthropic.js";
import { SeatGroup } from "../core/schemas.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const MODEL = process.env.SEAT_SCOUT_MODEL ?? "claude-sonnet-5-5";
const FORCE_DETERMINISTIC = process.env.SEAT_SCOUT_MODE === "deterministic";
const KEY = process.env.ANTHROPIC_API_KEY;
const pricing: Pricing = existsSync(join(ROOT, "config/pricing.json")) ? JSON.parse(readFileSync(join(ROOT, "config/pricing.json"), "utf8"))[MODEL] ?? { inputPerMTokUSD: null, outputPerMTokUSD: null } : { inputPerMTokUSD: null, outputPerMTokUSD: null };

const ds = loadDataset();
const config = loadConfig(), policy = loadPolicy();
const model = KEY && !FORCE_DETERMINISTIC ? anthropicClient(KEY, MODEL) : null;
const agent: AgentRunner | null = model ? (s, t, tr) => agentTurn(s, t, tr, model) : null;
const sessions = new Map<string, { session: Session; seen: number; hits: number[] }>();
const SESSION_TTL_MS = 2 * 60 * 60 * 1000, MAX_SESSIONS = 500, RATE_PER_MIN = 30;

function getSession(req: IncomingMessage): { session: Session; seen: number; hits: number[] } | null {
  const sid = /(?:^|;\s*)ss_sid=([a-f0-9]{32})/.exec(req.headers.cookie ?? "")?.[1];
  const entry = sid ? sessions.get(sid) : undefined;
  if (!entry || Date.now() - entry.seen > SESSION_TTL_MS) return null;
  entry.seen = Date.now();
  return entry;
}
function newSession(res: ServerResponse) {
  if (sessions.size >= MAX_SESSIONS) for (const [k, v] of sessions) if (Date.now() - v.seen > SESSION_TTL_MS || sessions.size >= MAX_SESSIONS) sessions.delete(k);
  const id = randomBytes(16).toString("hex");
  const entry = { session: new Session(id, ds, loadSnapshot()), seen: Date.now(), hits: [] as number[] };
  sessions.set(id, entry);
  res.setHeader("Set-Cookie", `ss_sid=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=7200`);
  return entry;
}
function send(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(body));
}
async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const c of req) { size += c.length; if (size > 16_384) throw new HttpError(413, "request too large"); chunks.push(c as Buffer); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new HttpError(400, "invalid JSON"); }
}
class HttpError extends Error { constructor(public code: number, msg: string) { super(msg); } }

const ChatBody = z.object({ text: z.string().trim().min(1).max(1000) }).strict();
const SelectBody = z.object({ seats: SeatGroup }).strict();
const TakenBody = z.object({ seat: z.string().regex(/^\d{1,2}[A-Fa-f]$/).optional() }).strict();

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  const rel = url.pathname === "/" ? "web/index.html" : url.pathname.startsWith("/dist/") ? "web" + url.pathname : url.pathname.startsWith("/web/") ? url.pathname.slice(1) : null;
  if (!rel) return send(res, 404, { error: "not found" });
  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(join(ROOT, "web")) || !existsSync(file) || !statSync(file).isFile()) return send(res, 404, { error: "not found" });
  res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
  res.end(readFileSync(file));
}

export const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://x");
    if (!url.pathname.startsWith("/api/")) return serveStatic(req, res);
    if (req.method === "POST" && req.headers["content-type"]?.split(";")[0] !== "application/json") throw new HttpError(415, "use application/json");
    if (url.pathname === "/api/session" && req.method === "POST") {
      const e = getSession(req) ?? newSession(res);
      return send(res, 200, { ok: true, mode: agent ? "live" : "deterministic", model: agent ? MODEL : null, snapshotVersion: e.session.availability.version });
    }
    const entry = getSession(req);
    if (!entry) throw new HttpError(401, "no session: POST /api/session first");
    const now = Date.now(); entry.hits = entry.hits.filter((t) => now - t < 60_000); entry.hits.push(now);
    if (entry.hits.length > RATE_PER_MIN) throw new HttpError(429, "slow down: rate limit per session");
    const s = entry.session;
    switch (`${req.method} ${url.pathname}`) {
      case "GET /api/config":
        return send(res, 200, { config, policy, takenSeats: s.availability.latest.takenSeats, snapshotVersion: s.availability.version, mode: agent ? "live" : "deterministic", model: agent ? MODEL : null, state: s.state });
      case "POST /api/chat": {
        const { text } = ChatBody.parse(await readJson(req));
        return send(res, 200, await handleTurn(s, text, agent, pricing));
      }
      case "POST /api/select": {
        const { seats } = SelectBody.parse(await readJson(req));
        return send(res, 200, selectSeats(s, seats));
      }
      case "POST /api/demo/seat-taken": {
        const { seat } = TakenBody.parse(await readJson(req));
        return send(res, 200, simulateSeatTaken(s, seat));
      }
      case "POST /api/demo/impossible":
        return send(res, 200, await handleTurn(s, "Make the total budget £1.", agent, pricing));
      case "POST /api/demo/tool-timeout":
        s.faults.toolTimeoutOnce = true;
        return send(res, 200, await handleTurn(s, s.lastUserText || "Show me the best options again.", agent, pricing));
      case "POST /api/reset":
        sessions.delete(s.id);
        return send(res, 200, { ok: true });
      case "GET /api/eval/latest": {
        const f = join(ROOT, "eval/results/latest.json");
        return send(res, 200, existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : { error: "no evaluation results yet: run npm run eval" });
      }
      default: throw new HttpError(404, "unknown endpoint");
    }
  } catch (e: any) {
    if (e instanceof z.ZodError) return send(res, 400, { error: "invalid request", issues: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    if (e instanceof HttpError) return send(res, e.code, { error: e.message });
    console.error(e);
    return send(res, 500, { error: "internal error" }); // details stay in server logs
  }
});

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  server.listen(PORT, () => console.log(`Seat Scout on http://localhost:${PORT}  mode=${agent ? `live (${MODEL})` : "deterministic (no ANTHROPIC_API_KEY or SEAT_SCOUT_MODE=deterministic)"}`));
}
