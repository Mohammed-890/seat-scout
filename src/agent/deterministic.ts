/**
 * Deterministic planner: the no-model mode (and the fallback when the model fails).
 * The rule-based parser interprets the message; the planner then calls the SAME tools the model uses,
 * through the same validated executor, so its trace is a real execution trace.
 */
import { parseMessage } from "../core/parser.js";
import { Session, executeTool, buildCards, engineTraceEvents, stateSummary, prefSummary } from "../app/session.js";
import type { Trace } from "../app/trace.js";
import { cheapestFeasible } from "../core/engine.js";
import { applyPatch } from "../core/state.js";

export interface PlanOutput { message: string; question?: string; groups: string[][]; comparison?: unknown; rowExplanation?: unknown; toolCalls: number }

export async function deterministicTurn(session: Session, text: string, trace: Trace): Promise<PlanOutput> {
  let toolCalls = 0;
  const call = async (name: string, input: unknown) => {
    toolCalls++;
    let r = await executeTool(session, name, input, trace);
    if (!r.ok && /timed out/.test(r.error ?? "")) { trace.add("note", `Retrying ${name} once after timeout`, undefined, { status: "warn" }); toolCalls++; r = await executeTool(session, name, input, trace); }
    return r;
  };
  const top = session.state.lastRecommendation?.groups?.[0];
  const topTotal = top ? top.reduce((a, id) => a + (session.ds.seats.get(id)?.priceGBP ?? 0), 0) : null;
  const p = parseMessage(text, session.state, { topTotalGBP: topTotal });
  trace.add("parsed", `Rule-based interpretation (${p.language}): ${p.intent.kind}`, { intent: p.intent, patch: p.patch, notes: p.notes, injectionAttempt: p.injectionAttempt });

  if (p.intent.kind === "clarify") return { message: p.intent.question, question: p.intent.question, groups: [], toolCalls };
  if (p.intent.kind === "unsupported")
    return { message: "In this no-model mode I can only handle seat requests: who is travelling, your budget, window or aisle, legroom, sitting together, “why not row N?” and comparisons. Try describing your party, budget and seat preference.", groups: [], toolCalls };

  if (p.notes.includes("cheaper-than-current") && topTotal != null) {
    // Only lower the budget if something cheaper actually satisfies everything else.
    const probe = applyPatch(session.state, p.patch).state;
    const cheaper = cheapestFeasible(probe, session.ctx());
    trace.add("note", `“Cheaper”: cheapest feasible total under £${topTotal} is ${cheaper ? `£${cheaper.totalGBP} (${cheaper.id})` : "none"}`, undefined, { seats: cheaper?.seats });
    if (!cheaper) {
      const q = "Would you like me to relax another requirement (for example the window preference or the zone), or keep the current option?";
      return { message: `Your current option (total £${topTotal}) is already the cheapest that meets all your requirements, so I haven't changed anything. ${q}`, question: q, groups: session.state.lastRecommendation?.groups ?? [], toolCalls };
    }
  }
  if (Object.keys(p.patch).length) {
    const u = await call("updateTripPreferences", p.patch);
    if (!u.ok) return { message: `I couldn't apply that change (${u.error}).`, groups: [], toolCalls };
  }
  trace.add("state", "Constraints vs preferences", { hard: stateSummary(session.state), preferences: prefSummary(session.state), revision: session.state.revision });

  if (p.intent.kind === "why_not_row") {
    const ev = await call("getSeatEvidence", { row: p.intent.row });
    if (!ev.ok) return { message: `I couldn't fetch row ${p.intent.row} (${ev.error}).`, groups: [], toolCalls };
    const groups = (ev.output as any).row.groups as Array<{ group: string; totalGBP: number; feasible: boolean; reasons: Array<{ detail: string }>; rankAmongRows: number | null; score: any }>;
    const lines = groups.map((g) => g.feasible ? `${g.group} (£${g.totalGBP}) is feasible but scores ${g.score.score}, below the options shown` : `${g.group}: ${g.reasons.map((r) => r.detail).join("; ")}`);
    return { message: `Row ${p.intent.row}, checked against your current requirements:\n• ${lines.join("\n• ")}`, groups: session.state.lastRecommendation?.groups ?? [], rowExplanation: groups, toolCalls };
  }

  const f = await call("findAdjacentSeatGroups", { topK: 3 });
  if (!f.ok) return { message: `The seat search failed (${f.error}). Your preferences are saved; please try again.`, groups: [], toolCalls };
  const res: any = f.output;
  if (session.lastEngine) engineTraceEvents(session.lastEngine, trace);
  if (res.status === "needs_info") return { message: `I need ${res.missing.join(" and ")} before I can search.`, question: `How many people are travelling, and is anyone under 16?`, groups: [], toolCalls };
  if (res.status === "no_feasible") {
    const opts = res.conflicts.filter((c: any) => c.wouldMatch > 0).map((c: any) => `${c.change} (${c.wouldMatch} option${c.wouldMatch > 1 ? "s" : ""}${c.note ? `; ${c.note}` : ""})`);
    const q = "Which of these are you willing to change?";
    return { message: `Nothing in the current snapshot satisfies all of: ${stateSummary(session.state).join(", ")}.${opts.length ? ` Options: ${opts.join("; ")}.` : " No single change makes this feasible."} I won't go over budget or split the group without your say-so. ${q}`, question: q, groups: [], toolCalls };
  }
  const groups: string[][] = res.ranked.map((g: any) => g.seats);
  const v = await call("validateRecommendation", { groups });
  if (!v.ok) return { message: `I found options but couldn't validate them (${v.error}).`, groups: [], toolCalls };

  if (p.intent.kind === "compare_cheapest" || p.intent.kind === "compare_top_two") {
    let b: string[] | undefined;
    if (p.intent.kind === "compare_cheapest") {
      b = cheapestFeasible(session.state, session.ctx())?.seats;
      trace.add("note", `Cheapest feasible group by code: ${b?.join("+") ?? "none"}`, undefined, { seats: b });
    } else b = groups[1];
    const a = session.state.lastRecommendation?.groups?.[0] ?? groups[0];
    if (!b || a.join() === b.join()) return { message: `${a.join("+")} is already the cheapest valid option for these requirements.`, groups: [a], toolCalls };
    const c = await call("compareSeatOptions", { a, b });
    const cmp: any = c.output;
    const d = cmp.totalGBP.delta;
    const msg = `${cmp.b} vs ${cmp.a}: ${d === 0 ? "same total" : d < 0 ? `£${-d} cheaper in total` : `£${d} more in total`} (calculated); pitch ${cmp.pitchIn.b}″ vs ${cmp.pitchIn.a}″; estimated knee space ${cmp.kneeSpaceCm.b} vs ${cmp.kneeSpaceCm.a} cm; window ${fmtWin(cmp.window.b)} vs ${fmtWin(cmp.window.a)}; recline ${cmp.recline.b} vs ${cmp.recline.a}.`;
    return { message: msg, groups: [a, b], comparison: cmp, toolCalls };
  }

  const best = res.ranked[0];
  const prevTop = top?.join("+");
  if (prevTop && prevTop === best.seats.join("+") && Object.keys(p.patch).length) {
    const msg = `Updated your requirements (${stateSummary(session.state).join(", ")}). The best option is unchanged: row ${best.row}, ${best.seats.join(", ")}, total £${best.totalGBP}, which already satisfies them.`;
    return { message: msg, groups, toolCalls };
  }
  const note = p.notes.filter((n) => n !== "cheaper-than-current").length ? ` (${p.notes.filter((n) => n !== "cheaper-than-current").join(" ")})` : "";
  const msg = `Best fit for ${stateSummary(session.state).join(", ")}: row ${best.row}, seats ${best.seats.join(", ")}, total £${best.totalGBP}. ${best.strengths.length ? cap(best.strengths.join(", ")) + "." : ""}${best.compromises.length ? ` Compromise: ${best.compromises.join(", ")}.` : ""} ${res.ranked.length - 1 ? `${res.ranked.length - 1} alternative${res.ranked.length > 2 ? "s" : ""} below.` : ""}${note}`.replace(/\s+/g, " ").trim();
  return { message: msg, groups, toolCalls };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtWin = (w: any) => (w ? `${w.view.replace("_", " ")}, ${w.alignment.replace(/_/g, " ")}` : "none");
