/**
 * Evaluation runner.
 *   npm run eval        -> deterministic pipeline (rule-based parser + tools) vs a naive baseline
 *   npm run eval:live   -> tool-grounded Claude agent vs a no-tools Claude baseline (needs ANTHROPIC_API_KEY)
 * Checks are written against the RAW data files (eval/checks.ts), not the engine, so an engine bug
 * cannot certify itself. Results: eval/results/<date>-<mode>.json, latest.json and REPORT.md.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { loadDataset, loadSnapshot } from "../src/core/load-node.js";
import { Session, type TurnResult } from "../src/app/session.js";
import { handleTurn, simulateSeatTaken, type AgentRunner } from "../src/app/turn.js";
import { agentTurn } from "../src/agent/agent.js";
import { anthropicClient } from "../src/server/anthropic.js";
import { parseMessage } from "../src/core/parser.js";
import { applyPatch, seatsNeeded } from "../src/core/state.js";
import { checkCase, type Case, type CaseRun } from "./checks.js";
import { llmBaseline } from "./llm-baseline.js";

const args = process.argv.slice(2);
const mode = args.includes("--mode") ? args[args.indexOf("--mode") + 1] : "deterministic";
const only = args.includes("--case") ? args[args.indexOf("--case") + 1] : null;
const tag = args.includes("--tag") ? args[args.indexOf("--tag") + 1] : null;
const suite = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8"));
const cases: Case[] = suite.cases.filter((c: Case) => !only || c.id === only);
const ds = loadDataset();
const MODEL = process.env.SEAT_SCOUT_MODEL ?? "claude-sonnet-5-5";

async function runSystem(c: Case, agent: AgentRunner | null): Promise<CaseRun> {
  const s = new Session(`eval-${c.id}`, ds, loadSnapshot());
  const takenByDemo: string[] = [];
  let prevTopTotal: number | null = null, last: TurnResult | null = null;
  const t0 = Date.now();
  let tokens = { input: 0, output: 0 }, modelCalls = 0;
  for (const turn of c.turns) {
    if (last?.groups.length) prevTopTotal = last.groups[0].totalGBP;
    if (typeof turn === "string") last = await handleTurn(s, turn, agent);
    else { last = simulateSeatTaken(s); const ev = last.trace.find((e) => e.kind === "snapshot"); if (ev?.seats) takenByDemo.push(...ev.seats); }
    tokens.input += last.metrics.inputTokens ?? 0; tokens.output += last.metrics.outputTokens ?? 0; modelCalls += last.metrics.modelCalls ?? 0;
  }
  return { result: last!, state: s.state, takenSeats: s.availability.latest.takenSeats, takenByDemo, prevTopTotal, latencyMs: Date.now() - t0, tokens, modelCalls, model: last!.metrics.model };
}

/** Naive heuristic baseline: SAME parser, but no constraint engine. Picks the cheapest free seats individually. */
async function runNaive(c: Case): Promise<CaseRun> {
  const s = new Session(`naive-${c.id}`, ds, loadSnapshot());
  let state = s.state;
  const t0 = Date.now();
  for (const turn of c.turns) {
    if (typeof turn !== "string") continue;
    try { state = applyPatch(state, parseMessage(turn, state).patch).state; } catch { /* ignore */ }
  }
  const n = Math.max(1, seatsNeeded(state));
  const wantPos = state.hard.position ?? (state.prefs.window ? "window" : state.prefs.aisle ? "aisle" : null);
  const free = ds.seatList.filter((x) => s.availability.isFree(x.id)).sort((a, b) => a.priceGBP - b.priceGBP || a.row - b.row);
  const first = free.find((x) => !wantPos || x.position === wantPos) ?? free[0];
  const rest = free.filter((x) => x.id !== first.id).slice(0, n - 1);
  const seats = [first, ...rest].map((x) => x.id);
  const result = { outcome: "recommend", mode: "deterministic", message: `Seats ${seats.join(", ")}.`, groups: [{ seats, totalGBP: [first, ...rest].reduce((a, x) => a + x.priceGBP, 0) }], trace: [] } as unknown as TurnResult;
  return { result, state, takenSeats: s.availability.latest.takenSeats, takenByDemo: [], prevTopTotal: null, latencyMs: Date.now() - t0, tokens: { input: 0, output: 0 }, modelCalls: 0 };
}

function aggregate(name: string, rows: ReturnType<typeof checkCase>[]) {
  const sum = (k: keyof (typeof rows)[number]["counts"]) => rows.reduce((a, r) => a + r.counts[k], 0);
  const lat = rows.map((r) => r.latencyMs).sort((a, b) => a - b);
  const pct = (p: number) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))];
  const rate = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
  const frac = (a: number, b: number, unit: string) => ({ num: a, den: b, pct: rate(a, b), unit });
  const passed = rows.filter((r) => r.pass).length, outcomeOk = rows.filter((r) => r.outcomeOk).length;
  const byCat: Record<string, { pass: number; total: number }> = {};
  for (const r of rows) { byCat[r.category] ??= { pass: 0, total: 0 }; byCat[r.category].total++; if (r.pass) byCat[r.category].pass++; }
  return {
    system: name, cases: rows.length, passed: rows.filter((r) => r.pass).length,
    metrics: {
      casePassRatePct: rate(rows.filter((r) => r.pass).length, rows.length),
      hardConstraintSatisfactionPct: rate(sum("groupsSatisfyingHard"), sum("groupsShown")),
      validSeatAndAvailabilityPct: rate(sum("groupsValidRefs"), sum("groupsShown")),
      adjacencyAndPriceCorrectPct: rate(sum("groupsAdjacentPriceOk"), sum("groupsShown")),
      impossibleHandledPct: rate(sum("impossibleHandled"), sum("impossibleCases")),
      outcomeCorrectPct: rate(rows.filter((r) => r.outcomeOk).length, rows.length),
      multiTurnStatePct: rate(sum("stateFieldsCorrect"), sum("stateFieldsChecked")),
      preferenceHitPct: rate(sum("prefHits"), sum("prefChecks")),
      unsupportedNumericClaims: sum("unsupportedClaims"),
      latencyMsP50: pct(0.5), latencyMsP95: pct(0.95),
      inputTokens: rows.reduce((a, r) => a + r.tokens.input, 0), outputTokens: rows.reduce((a, r) => a + r.tokens.output, 0),
    },
    /** Each figure carries its numerator, denominator and unit, so different denominators cannot be confused. */
    fractions: {
      casesPassed: frac(passed, rows.length, "cases"),
      requestUnderstanding: frac(sum("reqEncoded"), sum("reqStated"), "stated requirements present in the structured state"),
      requestUnderstandingCases: frac(sum("casesUnderstood"), sum("casesWithReq"), "cases with every stated requirement encoded"),
      parsedConstraintSatisfaction: frac(sum("groupsSatisfyingParsed"), sum("groupsShown"), "shown seat groups meeting the parsed constraints"),
      actualRequirementSatisfaction: frac(sum("groupsSatisfyingHard"), sum("groupsShown"), "shown seat groups meeting what the passenger asked for"),
      impossibleRecognised: frac(sum("impossibleHandled"), sum("impossibleCases"), "impossible cases answered with no seats and an explanation"),
      outcomeCorrect: frac(outcomeOk, rows.length, "cases"),
      validSeatRefs: frac(sum("groupsValidRefs"), sum("groupsShown"), "shown seat groups"),
      adjacencyAndPrice: frac(sum("groupsAdjacentPriceOk"), sum("groupsShown"), "shown seat groups"),
      multiTurnState: frac(sum("stateFieldsCorrect"), sum("stateFieldsChecked"), "checked state fields"),
      preferenceHits: frac(sum("prefHits"), sum("prefChecks"), "preference checks"),
    },
    byCategory: byCat,
    failures: rows.filter((r) => !r.pass).map((r) => ({ id: r.id, category: r.category, problems: r.problems, message: r.message.slice(0, 240) })),
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const out: any = { suiteVersion: suite.version, startedAt, node: process.version, dataConfig: ds.config.configId, policy: ds.policy.policyId, cases: cases.length };
  if (mode === "deterministic") {
    const sys = [], naive = [];
    for (const c of cases) { sys.push(checkCase(c, await runSystem(c, null), ds)); naive.push(checkCase(c, await runNaive(c), ds)); }
    out.mode = "deterministic";
    out.description = "Rule-based parser + deterministic tools (the app's no-model mode) vs a naive baseline using the same parser without the constraint engine. No model involved.";
    out.systems = [aggregate("tool-grounded deterministic pipeline", sys), aggregate("naive baseline (same parser, no constraint engine)", naive)];
    out.perCase = sys.map((r) => ({ id: r.id, pass: r.pass, outcome: r.outcome, problems: r.problems }));
  } else {
    const key = process.env.ANTHROPIC_API_KEY;
    out.mode = "live";
    if (!key) {
      out.status = "not_run"; out.reason = "ANTHROPIC_API_KEY is not set. No live numbers are reported.";
    } else {
      const model = anthropicClient(key, MODEL);
      const agent: AgentRunner = (s, t, tr) => agentTurn(s, t, tr, model);
      const sys = [], base = [];
      for (const c of cases) { sys.push(checkCase(c, await runSystem(c, agent), ds)); base.push(checkCase(c, await llmBaseline(c, model, ds), ds)); }
      out.model = MODEL; out.settings = { temperature: 0, maxSteps: 8 };
      out.systems = [aggregate(`tool-grounded agent (${MODEL})`, sys), aggregate(`no-tools LLM baseline (${MODEL})`, base)];
      out.perCase = sys.map((r) => ({ id: r.id, pass: r.pass, outcome: r.outcome, problems: r.problems }));
    }
  }
  out.finishedAt = new Date().toISOString();
  mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
  const day = startedAt.slice(0, 10);
  if (tag) out.tag = tag;
  writeFileSync(new URL(`./results/${day}-${out.mode}${tag ? "-" + tag : ""}.json`, import.meta.url), JSON.stringify(out, null, 1));
  if (tag) { for (const s of out.systems ?? []) console.log(`${s.system}:`, JSON.stringify(Object.fromEntries(Object.entries(s.fractions).map(([k, v]: any) => [k, `${v.num}/${v.den}`])))); return; }
  if (out.mode === "deterministic" && !only) writeFileSync(new URL("./results/latest.json", import.meta.url), JSON.stringify(out, null, 1));
  if (!only) writeReport(out);
  for (const s of out.systems ?? []) console.log(`${s.system}:`, JSON.stringify(Object.fromEntries(Object.entries(s.fractions).map(([k, v]: any) => [k, `${v.num}/${v.den}`]))));
  if (out.status === "not_run") console.log(out.reason);
}

function writeReport(o: any) {
  const path = new URL("./results/REPORT.md", import.meta.url);
  let prev = ""; try { prev = readFileSync(path, "utf8"); } catch { /* first run */ }
  const F = (f: any) => (f && f.den ? `${f.num}/${f.den} (${f.pct}%)` : "n/a");
  const sec = (o.systems ?? []).map((s: any) => `| ${s.system} | ${F(s.fractions.casesPassed)} | ${F(s.fractions.requestUnderstanding)} | ${F(s.fractions.parsedConstraintSatisfaction)} | ${F(s.fractions.actualRequirementSatisfaction)} | ${F(s.fractions.impossibleRecognised)} | ${F(s.fractions.adjacencyAndPrice)} | ${F(s.fractions.multiTurnState)} | ${s.metrics.unsupportedNumericClaims} | ${s.metrics.latencyMsP50}/${s.metrics.latencyMsP95} |`).join("\n");
  const fails = (o.systems ?? []).map((s: any) => `\n**${s.system}: failures (${s.failures.length})**\n${s.failures.map((f: any) => `- \`${f.id}\` (${f.category}): ${f.problems.join("; ")}`).join("\n") || "- none"}`).join("\n");
  const block = `<!-- ${o.mode} -->\n## ${o.mode === "live" ? "Live-model evaluation" : "Deterministic evaluation"} · ${o.startedAt}\n\n${o.status === "not_run" ? `**Not run:** ${o.reason}\n` : `${o.description ?? `Model: ${o.model}, settings ${JSON.stringify(o.settings)}`}\nData: \`${o.dataConfig}\`, policy \`${o.policy}\`, ${o.cases} cases, Node ${o.node}.\n\nDenominators differ: requirements stated across cases, seat groups shown, impossible cases, state fields checked. Parsed-constraint satisfaction checks shown groups against the structured state; it cannot catch a requirement the parser never recorded. Actual-requirement satisfaction checks against what the case says the passenger asked for.\n\n| System | Cases passed | Request understanding (requirements) | Parsed-constraint satisfaction (groups) | Actual-requirement satisfaction (groups) | Impossible recognised (cases) | Adjacency & price (groups) | Multi-turn state (fields) | Unsupported numeric claims | Latency p50/p95 ms |\n|---|---|---|---|---|---|---|---|---|---|\n${sec}\n${fails}\n`}<!-- /${o.mode} -->`;
  const re = new RegExp(`<!-- ${o.mode} -->[\\s\\S]*?<!-- /${o.mode} -->`);
  const head = "# Evaluation report\n\nGenerated by `eval/run.ts`. Case definitions: `eval/cases.json` (written before running). Checks: `eval/checks.ts` (against raw data files).\n\n";
  const body = prev.includes("# Evaluation report") ? (re.test(prev) ? prev.replace(re, block) : prev + "\n" + block + "\n") : head + block + "\n";
  writeFileSync(path, body);
}

main().catch((e) => { console.error(e); process.exit(1); });
