/**
 * Application execution trace: what the system actually did (inputs, tool calls, validated arguments,
 * results, exclusions, scores, validation). It records events, not model chain-of-thought.
 */
export type TraceKind =
  | "request" | "parsed" | "state" | "model_call" | "tool_call" | "tool_result" | "tool_error"
  | "candidates" | "exclusions" | "scores" | "validation" | "snapshot" | "fallback" | "final" | "note";

export interface TraceEvent {
  t: number;              // ms since turn start
  kind: TraceKind;
  title: string;
  data?: unknown;
  seats?: string[];       // links the event to seats in the 3D scene
  status?: "ok" | "warn" | "error";
}

export class Trace {
  readonly events: TraceEvent[] = [];
  private t0 = Date.now();
  add(kind: TraceKind, title: string, data?: unknown, extra: Partial<TraceEvent> = {}): void {
    this.events.push({ t: Date.now() - this.t0, kind, title, data: redact(data), ...extra });
  }
}

/** Keeps secrets and oversized payloads out of the client-visible trace. */
function redact(v: unknown): unknown {
  if (v == null) return v;
  const s = JSON.stringify(v, (k, val) => (/key|token|secret|authorization/i.test(k) ? "[redacted]" : val));
  if (s && s.length > 6000) return { truncated: true, preview: s.slice(0, 6000) };
  return s === undefined ? undefined : JSON.parse(s);
}
