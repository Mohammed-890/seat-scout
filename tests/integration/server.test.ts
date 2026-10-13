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
