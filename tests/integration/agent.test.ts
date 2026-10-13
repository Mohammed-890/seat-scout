/**
 * Integration tests for tools, the agent loop and recovery paths.
 * The "model" here is a SCRIPTED TEST DOUBLE that replays fixed tool calls: it tests our loop,
 * validation and fallbacks, not model quality. Live-model behaviour is measured by `npm run eval:live`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDataset, loadSnapshot } from "../../src/core/load-node.js";
import { Session, executeTool } from "../../src/app/session.js";
import { handleTurn, simulateSeatTaken, selectSeats, type AgentRunner } from "../../src/app/turn.js";
import { agentTurn, type ModelClient, type ModelResponse } from "../../src/agent/agent.js";
import { Trace } from "../../src/app/trace.js";

const ds = loadDataset();
const fresh = () => new Session("s" + Math.random(), ds, loadSnapshot());
const DEMO = "We're two adults travelling with a five-year-old. Our total seat budget is £45. We want to sit together, and I'd prefer a window away from the wing.";

let n = 0;
const use = (name: string, input: unknown) => ({ type: "tool_use" as const, id: `tu_${++n}`, name, input });
function scripted(steps: Array<ModelResponse["content"]>): ModelClient {
  let i = 0;
  return { name: "scripted-test-double", async create() { const content = steps[Math.min(i++, steps.length - 1)]; return { content, stop_reason: "tool_use", usage: { input_tokens: 100, output_tokens: 20 }, model: "scripted-test-double" }; } };
}
const runnerFor = (m: ModelClient): AgentRunner => (s, t, tr) => agentTurn(s, t, tr, m);
const familyPatch = { setTravellers: [{ type: "adult" }, { type: "adult" }, { type: "child", age: 5 }], budgetTotalGBP: 45, together: true, prefs: { window: 1, clearView: 1 } };

test("tool executor validates arguments before running", async () => {
  const s = fresh(), tr = new Trace();
  const bad = await executeTool(s, "updateTripPreferences", { budgetTotalGBP: "lots" }, tr);
  assert.equal(bad.ok, false);
  assert.match(bad.error!, /budgetTotalGBP/);
  assert.equal(s.state.revision, 0, "invalid input must not change state");
  const unknown = await executeTool(s, "bookFlight", {}, tr);
  assert.equal(unknown.ok, false);
});

test("agent: invented seat and over-budget submissions are rejected; only validated cards are shown", async () => {
  const s = fresh();
  const model = scripted([
    [use("updateTripPreferences", familyPatch)],
    [use("findAdjacentSeatGroups", {})],
    [use("submitRecommendation", { message: "Take 31A-31C, total £5.", groups: [["31A", "31B", "31C"]] })],
    [use("submitRecommendation", { message: "Row 18 then row 1.", groups: [["18A", "18B", "18C"], ["1D", "1E", "1F"]] })],
  ]);
  // second submit contains one valid and one invalid (bulkhead row over budget/taken) group -> rejected as a whole by submit; app shows none
  const r = await handleTurn(s, DEMO, runnerFor(model));
  assert.equal(r.mode, "deterministic-fallback", "two rejected submissions trigger the deterministic fallback");
  for (const g of r.groups) {
    assert.ok(g.totalGBP <= 45);
    assert.ok(g.seats.every((id) => ds.seats.has(id) && s.availability.isFree(id)));
  }
  assert.ok(!r.groups.some((g) => g.seats.includes("31A")));
  assert.ok(r.trace.some((e) => e.kind === "fallback"));
});

test("agent: a valid submission produces cards built from code (model totals ignored)", async () => {
  const s = fresh();
  const model = scripted([
    [use("updateTripPreferences", familyPatch)],
    [use("findAdjacentSeatGroups", {})],
    [use("validateRecommendation", { groups: [["18A", "18B", "18C"]] })],
    [use("submitRecommendation", { message: "Row 18 fits: total £999 (model typo).", groups: [["18a", "18b", "18c"]] })],
  ]);
  const r = await handleTurn(s, DEMO, runnerFor(model));
  assert.equal(r.mode, "live");
  assert.deepEqual(r.groups.map((g) => g.seats), [["18A", "18B", "18C"]]);
  assert.equal(r.groups[0].totalGBP, 12, "card total comes from the dataset");
  assert.equal(r.metrics.modelCalls, 4);
  assert.equal(r.metrics.inputTokens, 400);
  assert.deepEqual(r.trace.filter((e) => e.kind === "tool_call").map((e) => e.title), ["updateTripPreferences", "findAdjacentSeatGroups", "validateRecommendation", "submitRecommendation"]);
});

test("agent: model failure falls back to the deterministic planner, labelled", async () => {
  const s = fresh();
  const failing: ModelClient = { name: "down", async create() { throw new Error("503 overloaded"); } };
  const r = await handleTurn(s, DEMO, runnerFor(failing));
  assert.equal(r.mode, "deterministic-fallback");
  assert.ok(r.groups.length > 0);
  assert.ok(r.trace.some((e) => e.kind === "fallback" && /503/.test(e.title)));
});

test("agent: step limit is enforced", async () => {
  const s = fresh();
  const loop = scripted([[use("getCabinConfiguration", {})]]);
  const r = await handleTurn(s, "hello", runnerFor(loop));
  assert.equal(r.mode, "deterministic-fallback");
  assert.equal(r.trace.filter((e) => e.kind === "model_call").length, 8);
});

test("tool timeout: retried once, then succeeds (deterministic planner)", async () => {
  const s = fresh();
  s.faults.toolTimeoutOnce = true;
  const r = await handleTurn(s, DEMO, null);
  assert.ok(r.trace.some((e) => e.kind === "tool_error" && /timed out/.test(e.title)));
  assert.ok(r.trace.some((e) => e.kind === "note" && /Retrying/.test(e.title)));
  assert.ok(r.groups.length > 0);
});

test("journey: £45 → £25 → seat taken keeps preferences → selection revalidated", async () => {
  const s = fresh();
  const r1 = await handleTurn(s, DEMO, null);
  assert.ok(r1.groups.length > 0 && r1.groups.every((g) => g.totalGBP <= 45));
  const prefsBefore = structuredClone(s.state.prefs);
  const r2 = await handleTurn(s, "Actually, £25 maximum.", null);
  assert.equal(s.state.budget.totalGBP, 25);
  assert.deepEqual(s.state.prefs, prefsBefore);
  assert.ok(r2.groups.every((g) => g.totalGBP <= 25));
  const victim = r2.groups[0].seats;
  const revBefore = s.state.revision;
  const r3 = simulateSeatTaken(s, victim[0]);
  assert.equal(r3.snapshotVersion, 2);
  assert.equal(s.state.revision, revBefore, "recovery must not change preferences");
  assert.ok(r3.groups.every((g) => !g.seats.includes(victim[0])));
  assert.ok(r3.groups.every((g) => g.totalGBP <= 25 && !ds.seats.get(g.seats[0])!.exitRow));
  const stale = selectSeats(s, victim);
  assert.equal(stale.mode, "recovery", "selecting a now-taken group is refused");
  const ok = selectSeats(s, r3.groups[0].seats);
  assert.match(ok.message, /nothing has been booked/);
});

test("sessions are isolated", async () => {
  const a = fresh(), b = fresh();
  await handleTurn(a, DEMO, null);
  simulateSeatTaken(a, "18A");
  assert.equal(a.availability.isFree("18A"), false);
  assert.equal(b.availability.isFree("18A"), true);
  assert.equal(b.state.revision, 0);
});

test("retrieved passenger tips are returned as untrusted data and do not change results", async () => {
  const s = fresh(), tr = new Trace();
  await handleTurn(s, "1 adult, window, total budget £10", null);
  const before = s.state.lastRecommendation;
  const ev: any = (await executeTool(s, "getSeatEvidence", { seats: ["22C"] }, tr)).output;
  assert.equal(ev.seats[0].passengerTip.untrusted, true);
  assert.match(ev.seats[0].passengerTip.text, /SYSTEM NOTICE/);
  assert.deepEqual(s.state.lastRecommendation, before);
  assert.equal(s.state.budget.totalGBP, 10);
});
