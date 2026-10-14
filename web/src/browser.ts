/**
 * Browser bundle: exposes the shared core to the page as window.SeatCore, plus two API adapters
 * with the same interface:
 *   httpApi()  - talks to the Node server (live model server-side, or deterministic)
 *   localApi() - the claude.ai artifact preview: same core and tools in the browser; Claude via the
 *                viewer's own account when allowed, otherwise the deterministic planner (labelled).
 */
import { createDataset } from "../../src/core/dataset.js";
import { buildGeometry, windowAlignment, KNEE_RATIO, KNEE_Y, EYE_Y, PIVOT_Y, PIVOT_Z, SEAT_BACK_HEIGHT, shellZ, padZ } from "../../src/core/geometry.js";
import { Session, type TurnResult } from "../../src/app/session.js";
import { handleTurn, simulateSeatTaken, selectSeats, type AgentRunner } from "../../src/app/turn.js";
import { sampleRunner } from "../../src/agent/sample-runner.js";

export interface SeatApi {
  kind: "server" | "preview";
  init(): Promise<{ config: any; policy: any; takenSeats: string[]; mode: string; modeLabel: string; model: string | null }>;
  /** Resolves with the final mode label once live-model availability is known (preview only). */
  ready?: Promise<{ mode: string; modeLabel: string }>;
  chat(text: string, o?: CallOpts): Promise<TurnResult>;
  seatTaken(seat?: string): Promise<TurnResult>;
  impossible(o?: CallOpts): Promise<TurnResult>;
  toolTimeout(o?: CallOpts): Promise<TurnResult>;
  select(seats: string[]): Promise<TurnResult>;
  evalLatest(): Promise<any>;
}

/** onEvent receives real trace events while the turn runs; clientId makes a retry idempotent. */
export interface CallOpts { onEvent?: (e: any) => void; clientId?: string }
async function postStream(path: string, body: Record<string, unknown>, o: CallOpts = {}): Promise<TurnResult> {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json", accept: "application/x-ndjson" }, credentials: "same-origin", body: JSON.stringify({ ...body, ...(o.clientId ? { clientId: o.clientId } : {}) }) });
  if (!r.ok || !(r.headers.get("content-type") ?? "").includes("ndjson") || !r.body) {
    const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    if (!r.ok) throw Object.assign(new Error(j.error ?? `HTTP ${r.status}`), { status: r.status, issues: j.issues });
    return j; // replayed result for a duplicate clientId
  }
  const reader = r.body.getReader(), dec = new TextDecoder(); let buf = "", result: TurnResult | null = null;
  for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; const m = JSON.parse(line);
      if (m.type === "event") o.onEvent?.(m.event); else if (m.type === "result") result = m.result; else if (m.type === "error") throw new Error(m.error); } }
  if (!result) throw new Error("connection closed before the answer arrived");
  return result;
}
async function postJSON(path: string, body: unknown = {}) {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw Object.assign(new Error(j.error ?? `HTTP ${r.status}`), { status: r.status, issues: j.issues });
  return j;
}

export function httpApi(): SeatApi {
  return {
    kind: "server",
    async init() {
      await postJSON("/api/session");
      const r = await fetch("/api/config", { credentials: "same-origin" });
      const c = await r.json();
      return { ...c, modeLabel: c.mode === "live" ? `Live · ${c.model} · server-side tool use` : "Deterministic · rule-based parser · no model" };
    },
    chat: (text, o) => postStream("/api/chat", { text }, o),
    seatTaken: (seat) => postJSON("/api/demo/seat-taken", seat ? { seat } : {}),
    impossible: (o) => postStream("/api/demo/impossible", {}, o),
    toolTimeout: (o) => postStream("/api/demo/tool-timeout", {}, o),
    select: (seats) => postJSON("/api/select", { seats }),
    async evalLatest() { const r = await fetch("/api/eval/latest", { credentials: "same-origin" }); return r.json(); },
  };
}

export function localApi(embedded: { config: any; policy: any; snapshot: any; evalLatest: any }): SeatApi {
  const ds = createDataset(embedded.config, embedded.policy);
  const session = new Session("preview", ds, embedded.snapshot);
  let runner: AgentRunner | null = null;
  let modeLabel = "Preview · deterministic · rule-based parser, no model";
  const claude = (globalThis as any).claude;
  const ready = (async () => {
    try {
      const sample = claude?.use ? await claude.use("sample") : null;
      const limits = sample ? await sample.limits().catch(() => null) : null;
      if (sample && limits?.tools) { runner = sampleRunner(sample, { modelTier: "default" }); modeLabel = "Preview · live Claude via your claude.ai account · tools run in this page"; }
    } catch { /* stay deterministic */ }
    return { mode: runner ? "live" : "deterministic", modeLabel };
  })();
  let busy = false;
  const turn = async (text: string, o: CallOpts = {}) => {
    await ready;
    if (busy) throw Object.assign(new Error("a request is still running"), { status: 409 });
    busy = true;
    let r: TurnResult;
    try { r = await handleTurn(session, text, runner, undefined, { onEvent: o.onEvent }); } finally { busy = false; }
    if (r.mode === "deterministic-fallback" && r.trace.some((e) => /not_granted|tools_unavailable/.test(e.title))) { runner = null; modeLabel = "Preview · deterministic (Claude not allowed in this view)"; }
    return r;
  };
  return {
    kind: "preview",
    ready,
    async init() { return { config: embedded.config, policy: embedded.policy, takenSeats: session.availability.latest.takenSeats, mode: runner ? "live" : "deterministic", modeLabel, model: null }; },
    chat: turn,
    seatTaken: async (seat) => simulateSeatTaken(session, seat),
    impossible: (o) => turn("Make the total budget £1.", o),
    toolTimeout: async (o) => { session.faults.toolTimeoutOnce = true; return turn(session.lastUserText || "Show me the best options again.", o); },
    select: async (seats) => selectSeats(session, seats),
    evalLatest: async () => embedded.evalLatest,
  };
}

export const SeatCore = { createDataset, buildGeometry, windowAlignment, KNEE_RATIO, KNEE_Y, EYE_Y, PIVOT_Y, PIVOT_Z, SEAT_BACK_HEIGHT, shellZ, padZ, httpApi, localApi };
(globalThis as any).SeatCore = SeatCore;
