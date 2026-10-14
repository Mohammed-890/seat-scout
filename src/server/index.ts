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
interface Entry { session: Session; seen: number; hits: number[]; busy?: boolean; done?: { id: string; result: unknown } }
const sessions = new Map<string, Entry>();
const SESSION_TTL_MS = 2 * 60 * 60 * 1000, MAX_SESSIONS = 500, RATE_PER_MIN = 30;

function getSession(req: IncomingMessage): Entry | null {
  const sid = /(?:^|;\s*)ss_sid=([a-f0-9]{32})/.exec(req.headers.cookie ?? "")?.[1];
  const entry = sid ? sessions.get(sid) : undefined;
  if (!entry || Date.now() - entry.seen > SESSION_TTL_MS) return null;
  entry.seen = Date.now();
  return entry;
}
function newSession(res: ServerResponse) {
  if (sessions.size >= MAX_SESSIONS) for (const [k, v] of sessions) if (Date.now() - v.seen > SESSION_TTL_MS || sessions.size >= MAX_SESSIONS) sessions.delete(k);
  const id = randomBytes(16).toString("hex");
  const entry: Entry = { session: new Session(id, ds, loadSnapshot()), seen: Date.now(), hits: [] as number[] };
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

const ChatBody = z.object({ text: z.string().trim().min(1).max(1000), clientId: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/).optional() }).strict();
const DemoBody = z.object({ clientId: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/).optional() }).strict();
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

/**
 * One turn per session at a time (409 otherwise), idempotent retries by clientId (a retried request whose first
 * attempt completed gets the stored result instead of running twice), and optional NDJSON streaming of the real
 * trace events as they happen, so the client can show genuine progress.
 */
async function runTurn(req: IncomingMessage, res: ServerResponse, entry: Entry, clientId: string | undefined, fn: (o: { onEvent?: (e: unknown) => void }) => Promise<unknown>) {
  if (clientId && entry.done?.id === clientId) return send(res, 200, { ...(entry.done.result as object), replayed: true });
  if (entry.busy) throw new HttpError(409, "a request for this session is still running");
  entry.busy = true;
  const stream = String(req.headers.accept ?? "").includes("application/x-ndjson");
  try {
    if (!stream) { const r = await fn({}); if (clientId) entry.done = { id: clientId, result: r }; return send(res, 200, r); }
    res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
    const r = await fn({ onEvent: (e) => { if (!res.writableEnded) res.write(JSON.stringify({ type: "event", event: e }) + "\n"); } });
    if (clientId) entry.done = { id: clientId, result: r };
    res.end(JSON.stringify({ type: "result", result: r }) + "\n");
  } catch (e) {
    if (!stream || !res.headersSent) throw e;
    console.error(e); res.end(JSON.stringify({ type: "error", error: "internal error" }) + "\n");
  } finally { entry.busy = false; }
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
        const { text, clientId } = ChatBody.parse(await readJson(req));
        return await runTurn(req, res, entry, clientId, (o) => handleTurn(s, text, agent, pricing, o));
      }
      case "POST /api/select": {
        const { seats } = SelectBody.parse(await readJson(req));
        return send(res, 200, selectSeats(s, seats));
      }
      case "POST /api/demo/seat-taken": {
        const { seat } = TakenBody.parse(await readJson(req));
        return send(res, 200, simulateSeatTaken(s, seat));
      }
      case "POST /api/demo/impossible": {
        const { clientId } = DemoBody.parse(await readJson(req));
        return await runTurn(req, res, entry, clientId, (o) => handleTurn(s, "Make the total budget £1.", agent, pricing, o));
      }
      case "POST /api/demo/tool-timeout": {
        const { clientId } = DemoBody.parse(await readJson(req));
        return await runTurn(req, res, entry, clientId, (o) => { s.faults.toolTimeoutOnce = true; return handleTurn(s, s.lastUserText || "Show me the best options again.", agent, pricing, o); });
      }
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
