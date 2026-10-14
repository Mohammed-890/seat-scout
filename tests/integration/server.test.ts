import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

process.env.SEAT_SCOUT_MODE = "deterministic";
const { server } = await import("../../src/server/index.js");
let base = "";
before(async () => { await new Promise<void>((r) => server.listen(0, r)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; });
after(() => server.close());

const post = (path: string, body: unknown, cookie = "") =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });

test("API requires a session cookie", async () => {
  const r = await post("/api/chat", { text: "hi" });
  assert.equal(r.status, 401);
});

test("API validates bodies and content type", async () => {
  const s = await post("/api/session", {});
  const cookie = s.headers.get("set-cookie")!.split(";")[0];
  assert.match(s.headers.get("set-cookie")!, /HttpOnly/);
  assert.equal((await post("/api/chat", { text: "" }, cookie)).status, 400);
  assert.equal((await post("/api/chat", { text: "x", extra: 1 }, cookie)).status, 400);
  const wrongType = await fetch(base + "/api/chat", { method: "POST", headers: { cookie, "content-type": "text/plain" }, body: "hi" });
  assert.equal(wrongType.status, 415);
});

test("API journey: chat, demo seat taken, select", async () => {
  const s = await post("/api/session", {});
  const cookie = s.headers.get("set-cookie")!.split(";")[0];
  const chat = await (await post("/api/chat", { text: "2 adults, total budget £20, together, window" }, cookie)).json();
  assert.equal(chat.mode, "deterministic");
  assert.ok(chat.groups.length > 0);
  assert.ok(Array.isArray(chat.trace) && chat.trace.length > 3);
  assert.ok(!JSON.stringify(chat).match(/sk-ant|apiKey/i));
  const taken = await (await post("/api/demo/seat-taken", {}, cookie)).json();
  assert.equal(taken.snapshotVersion, 2);
  const sel = await (await post("/api/select", { seats: taken.groups[0].seats }, cookie)).json();
  assert.match(sel.message, /Demo seats selected/);
  const other = await post("/api/session", {});
  const cookie2 = other.headers.get("set-cookie")!.split(";")[0];
  const cfg = await (await fetch(base + "/api/config", { headers: { cookie: cookie2 } })).json();
  assert.equal(cfg.snapshotVersion, 1, "another session is unaffected");
});

test("streaming: NDJSON carries the real trace events before the final result", async () => {
  const s = await post("/api/session", {});
  const cookie = s.headers.get("set-cookie")!.split(";")[0];
  const r = await fetch(base + "/api/chat", { method: "POST", headers: { "content-type": "application/json", accept: "application/x-ndjson", cookie }, body: JSON.stringify({ text: "1 adult, aisle, total £10" }) });
  assert.match(r.headers.get("content-type")!, /ndjson/);
  const lines = (await r.text()).trim().split("\n").map((l) => JSON.parse(l));
  const events = lines.filter((l) => l.type === "event").map((l) => l.event);
  const result = lines.find((l) => l.type === "result").result;
  assert.equal(lines[lines.length - 1].type, "result");
  assert.ok(events.length >= 4);
  assert.deepEqual(events.map((e) => e.kind), result.trace.map((e: any) => e.kind), "streamed events are the same events as the final trace");
});

test("one turn at a time per session, and a retried request id is not run twice", async () => {
  const s = await post("/api/session", {});
  const cookie = s.headers.get("set-cookie")!.split(";")[0];
  await post("/api/chat", { text: "2 adults, total £20, together" }, cookie);
  // the tool-timeout demo really waits for the 3 s tool timeout, so a second request arrives mid-turn
  const slow = post("/api/demo/tool-timeout", { clientId: "req_slow01" }, cookie);
  await new Promise((r) => setTimeout(r, 300));
  const clash = await post("/api/chat", { text: "Cheaper." }, cookie);
  assert.equal(clash.status, 409, "a concurrent turn on the same session is refused, not interleaved");
  const first = await (await slow).json();
  assert.ok(first.trace.some((e: any) => e.kind === "tool_error"));
  const rev = first.state.revision;
  const again = await (await post("/api/demo/tool-timeout", { clientId: "req_slow01" }, cookie)).json();
  assert.equal(again.replayed, true, "same request id returns the stored answer");
  assert.deepEqual(again.groups, first.groups);
  const cfg = await (await fetch(base + "/api/config", { headers: { cookie } })).json();
  assert.equal(cfg.state.revision, rev, "the replay did not run the turn again");
});
