/**
 * Rule-based request interpreter (English + Arabic).
 * Used as the no-model deterministic mode and as the fallback when the model is unavailable.
 * It produces the SAME kind of state patch the model produces through the updateTripPreferences tool.
 * It is deliberately limited: unsupported phrasing yields a clarifying question, not a guess.
 */
import type { StatePatch, TripState, Traveller } from "./schemas.js";
import { seatsNeeded } from "./state.js";

export type Intent =
  | { kind: "search" }
  | { kind: "why_not_row"; row: number }
  | { kind: "compare_cheapest" }
  | { kind: "compare_top_two" }
  | { kind: "select" }
  | { kind: "clarify"; question: string }
  | { kind: "unsupported" };

export interface Parsed { patch: StatePatch; intent: Intent; notes: string[]; injectionAttempt: boolean; language: "en" | "ar" }

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  "واحد": 1, "اثنين": 2, "اثنان": 2, "ثلاثة": 3, "ثلاث": 3, "أربعة": 4, "خمسة": 5, "خمس": 5, "ستة": 6, "سبعة": 7, "ثمانية": 8, "تسعة": 9, "عشرة": 10 };

function normalise(text: string): string {
  let t = text.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/[’`]/g, "'")
    .replace(/شخصين/g, "2 أشخاص").replace(/طفلين/g, "2 أطفال");
  for (const [w, n] of Object.entries(NUM_WORDS)) t = t.replace(new RegExp(`(^|[^\\p{L}])${w}(?=$|[^\\p{L}])`, "giu"), `$1${n}`);
  return " " + t.toLowerCase() + " ";
}

export function parseMessage(text: string, state: TripState, ctx: { topTotalGBP?: number | null } = {}): Parsed {
  const q = normalise(text);
  const language = /[؀-ۿ]/.test(text) ? "ar" : "en";
  const patch: StatePatch = {};
  const notes: string[] = [];
  const has = (re: RegExp) => re.test(q);
  const injectionAttempt = has(/ignore (all |the |any |previous |your )*(rules|instructions|policy|budget)|override|system:|developer mode|تجاهل/);
  if (injectionAttempt) notes.push("Request asked to override rules; seating policy and validation still apply.");

  // ---------- intents that are questions about existing results ----------
  const why = q.match(/why (?:not|isn't|wasn't|didn't you pick) row (\d{1,2})/) || q.match(/(?:لماذا|ليش|ليه)[^\d]{0,20}الصف (\d{1,2})/);
  if (why) return { patch, intent: { kind: "why_not_row", row: Number(why[1]) }, notes, injectionAttempt, language };
  if (has(/compare .*cheapest|cheapest valid|قارن.*(أرخص|ارخص)/)) return { patch, intent: { kind: "compare_cheapest" }, notes, injectionAttempt, language };
  if (has(/giving up|give up|what do i lose|difference between/)) return { patch, intent: { kind: "compare_top_two" }, notes, injectionAttempt, language };
  if (has(/^\s*(select|choose|book|confirm|take) (that|this|these|them|it|the first)|اختر (هذا|هذه)|احجز/)) return { patch, intent: { kind: "select" }, notes, injectionAttempt, language };

  // ---------- travellers ----------
  const travellers: Traveller[] = [];
  let partyMentioned = false;
  const adults = q.match(/(\d) adults?/) || q.match(/(\d) (?:(?:أشخاص|اشخاص) )?(?:بالغين|بالغ|كبار)/);
  const ofUs = q.match(/(\d) of us/) || q.match(/(?:نحن|احنا) (\d)/) || q.match(/(\d) (?:أشخاص|اشخاص)(?! (?:بالغين|كبار))/);
  if (adults) { for (let i = 0; i < Number(adults[1]); i++) travellers.push({ type: "adult" }); partyMentioned = true; }
  if (has(/(me and my|my (wife|husband|partner|friend|mum|mom|dad)|زوجتي|زوجي)/) && !adults) { travellers.push({ type: "adult" }, { type: "adult" }); partyMentioned = true; }
  if (has(/just me|travelling alone|traveling alone|on my own|solo|by myself|لوحدي|وحدي/) && !adults) { travellers.push({ type: "adult" }); partyMentioned = true; }
  const childAges = [...q.matchAll(/(\d{1,2})[- ]year[- ]old/g)].map((m) => Number(m[1]))
    .concat([...q.matchAll(/(?:عمره|عمرها|عمر) (\d{1,2})/g)].map((m) => Number(m[1])));
  const infant = has(/\b(baby|infant|newborn)\b|رضيع/);
  for (const age of childAges) travellers.push(age < 2 ? { type: "infant", age } : age < 16 ? { type: "child", age } : { type: "adult", age });
  if (!childAges.length && has(/\b(child|kid|son|daughter|toddler)\b|طفل|ولد|بنت|ابني|بنتي/)) travellers.push({ type: "child" });
  if (infant && !childAges.some((a) => a < 2)) travellers.push({ type: "infant" });
  if (ofUs && !adults) {
    const total = Number(ofUs[1]);
    const minors = travellers.filter((t) => t.type !== "adult").length;
    for (let i = travellers.filter((t) => t.type === "adult").length; i < total - minors; i++) travellers.push({ type: "adult" });
    partyMentioned = true;
  }
  if (travellers.length) {
    if (!travellers.some((t) => t.type === "adult") && !state.travellers.some((t) => t.type === "adult") && !partyMentioned) travellers.unshift({ type: "adult" });
    patch.setTravellers = state.travellers.length && !partyMentioned && !adults ? [...state.travellers.filter((t) => t.type === "adult"), ...travellers.filter((t) => t.type !== "adult")] : travellers;
  }
  if (has(/(one|1) (person|of us|traveller|passenger) (is )?(no longer|not) (travelling|traveling|coming)|someone (cancelled|dropped out)|شخص (لن|ما) (يسافر|راح يسافر)/)) {
    const adultsNow = state.travellers.filter((t) => t.type === "adult").length;
    if (adultsNow >= 2) patch.removeTravellers = { type: "adult", count: 1 };
    else if (state.travellers.length) return { patch, intent: { kind: "clarify", question: "Who is no longer travelling: an adult or a child? (Children need an adult with them under the demo policy.)" }, notes, injectionAttempt, language };
  }

  // ---------- budget ----------
  const money = q.match(/(?:£|gbp ?)\s?(\d{1,4})/) || q.match(/(\d{1,4})\s?(?:pounds|quid|gbp|جنيه|باوند)/) || q.match(/(?:maximum|max|budget(?: is| of)?|up to|under|below|ميزانية|ميزانيتنا|حد أقصى)\s*(\d{1,4})/);
  if (money) {
    const v = Number(money[1]);
    const perSeat = has(/per seat|each|per person|a seat|للمقعد|لكل/);
    const total = has(/total|altogether|for all|in total|combined|for the (two|three) of us|الإجمالي|إجمالي|المجموع|للكل/) || seatsNeeded(state) > 1 || travellers.length > 1 || state.budget.totalGBP != null;
    if (perSeat && !has(/total/)) patch.budgetPerSeatGBP = v; else if (total) patch.budgetTotalGBP = v; else patch.budgetPerSeatGBP = v;
  }
  if (has(/\bfree seats?\b|don't want to pay|dont want to pay|no extra cost|مجان/)) patch.budgetTotalGBP = 0;
  if (has(/\bcheaper\b|less expensive|too expensive|أرخص|ارخص/)) {
    const top = ctx.topTotalGBP ?? null;
    if (top == null || top <= 0) return { patch, intent: { kind: "clarify", question: top === 0 ? "The current pick is already free, so nothing is cheaper. Would you like something better at the same price instead?" : "Cheaper than what? Tell me a budget, for example “under £20 in total”." }, notes, injectionAttempt, language };
    patch.budgetTotalGBP = top - 1; patch.prefs = { ...(patch.prefs ?? {}), cheap: 1 };
    notes.push("cheaper-than-current");
  }
  if (has(/(remove|no|drop|forget) (the )?budget|any price|money is no object/)) { patch.budgetTotalGBP = null; patch.budgetPerSeatGBP = null; }

  // ---------- seat position ----------
  const SOFT = /prefer|ideally|would like|i'd like|if possible|if available|where possible|nice to have|would be nice|rather|فضل|لو أمكن|لو امكن|ياريت|إن أمكن|ان امكن/;
  const soft = has(SOFT);
  const strong = has(/\bmust\b|\bneed\b|have to|only|required|essential|لازم|ضروري/);
  const WIN = /window|نافذة|شباك/, AISLE = /aisle|ممر/;
  const win = has(WIN), aisle = has(AISLE);
  if (win && aisle && /\band\b|و/.test(q) && !/\bor\b|أو/.test(q))
    return { patch, intent: { kind: "clarify", question: "A single seat can't be both window and aisle. For your group, should I require a window, an aisle, or just prefer one of them?" }, notes, injectionAttempt, language };
  // A seat position the passenger names ("window", "window seat", "مقعد شباك") is a requirement.
  // It is only a weighted preference when the clause that mentions it softens it ("prefer", "ideally", "if possible", "نفضل").
  // Judged per clause so "sit together, and I'd prefer a window" stays soft while "1 adult, window, total £2" is a requirement.
  const clauses = q.split(/[,.;!?،؛\n]| and | but /);
  const positionIsSoft = (re: RegExp) => clauses.filter((c) => re.test(c)).every((c) => SOFT.test(c));
  const negWin = has(/no window|not (a |the )?window|without (a )?window/);
  if (has(/keep the window/)) patch.prefs = { ...(patch.prefs ?? {}), window: Math.max(1, state.prefs.window) };
  else if (win && !negWin) {
    if (!positionIsSoft(WIN)) { patch.hard = { ...(patch.hard ?? {}), position: "window" }; notes.push("Window treated as a requirement (stated without a softening word)."); }
    patch.prefs = { ...(patch.prefs ?? {}), window: 1 };
  }
  if (aisle && !has(/not (an |the )?aisle|no aisle/)) {
    if (!positionIsSoft(AISLE)) { patch.hard = { ...(patch.hard ?? {}), position: "aisle" }; notes.push("Aisle treated as a requirement (stated without a softening word)."); }
    patch.prefs = { ...(patch.prefs ?? {}), aisle: 1 };
  }
  if (has(/leave (quickly|fast|first|easily)|get off (the plane )?(fast|quickly|first)|off the plane (quickly|fast|first)|get(ting)? out (easily|easy|quickly)|easy (to get out|access to the aisle|aisle access)|easier to get out|climb over|not (have to|want to) (climb|squeeze)|سهولة الخروج|اطلع بسهولة|أطلع بسهولة/)) {
    patch.prefs = { ...(patch.prefs ?? {}), aisle: 2 };
    if (state.hard.position === "window") { patch.hard = { ...(patch.hard ?? {}), position: null }; notes.push("Easier aisle access now outranks the window: the window is kept as a preference, not a requirement."); }
  }
  if (has(/any seat|don't mind where|dont mind where|anywhere is fine/)) { patch.hard = { ...(patch.hard ?? {}), position: null }; }

  // ---------- other attributes ----------
  if (has(/(away from|not (?:be )?over|not (?:be )?near|avoid) the wing|no wing|clear view|بعيد عن الجناح|مو على الجناح|بدون جناح/)) {
    patch.prefs = { ...(patch.prefs ?? {}), clearView: 1, window: Math.max(1, patch.prefs?.window ?? state.prefs.window) };
    if (strong && !soft) patch.hard = { ...(patch.hard ?? {}), clearViewRequired: true };
  }
  if (has(/legroom|leg room|more (space|room)|extra (space|room)|room to stretch|stretch out|tall|long legs|knee|مساحة للأرجل|مساحة أكبر|طويل/)) patch.prefs = { ...(patch.prefs ?? {}), legroom: 1 };
  const hcm = q.match(/(1[4-9]\d|2[0-2]\d) ?cm/), hft = q.match(/(\d) ?(?:'|ft|foot|feet) ?(\d{1,2})?/);
  if (hcm) patch.heightCm = Number(hcm[1]); else if (hft && Number(hft[1]) >= 4 && Number(hft[1]) <= 7) patch.heightCm = Math.round((Number(hft[1]) * 12 + Number(hft[2] ?? 0)) * 2.54);
  if (patch.heightCm && patch.heightCm >= 185) patch.prefs = { ...(patch.prefs ?? {}), legroom: 1 };
  if (has(/quiet|noise|calm|sleep|هادئ|هدوء|نوم/)) patch.prefs = { ...(patch.prefs ?? {}), quiet: 1 };
  // Sleeping: a window seat lets you lean on the wall and isn't disturbed by neighbours getting out (a preference, never a requirement).
  if (has(/\bsleep|nap|rest\b|نوم|أنام|انام/) && !aisle && !has(/not (a |the )?window|no window/)) patch.prefs = { ...(patch.prefs ?? {}), window: Math.max(1, patch.prefs?.window ?? 0) };
  if (has(/get off (the plane )?(fast|quickly|first)|leave (quickly|fast|first)|off the plane (quickly|fast|first)|tight connection|near the front|at the front|قريب من المقدمة/)) patch.prefs = { ...(patch.prefs ?? {}), front: 1 };
  if (has(/front (of the|section)|front cabin/) && strong) patch.hard = { ...(patch.hard ?? {}), zone: "front" };
  if (has(/cheap|budget|save money|cheapest|رخيص/)) patch.prefs = { ...(patch.prefs ?? {}), cheap: Math.max(1, patch.prefs?.cheap ?? 0) };
  if (has(/exit row|مخرج الطوارئ|صف الطوارئ/) && !has(/no exit|not (an |the )?exit|avoid (the )?exit/)) patch.hard = { ...(patch.hard ?? {}), exitRowOnly: true };
  if (has(/not (in |the |an )?exit|no exit|avoid (the )?exit/)) patch.hard = { ...(patch.hard ?? {}), exitRowOnly: false };
  if (has(/recline|lean back/)) patch.hard = { ...(patch.hard ?? {}), fullRecline: true };
  if (has(/bag under|under.?seat|small bag/)) patch.hard = { ...(patch.hard ?? {}), underSeatBag: true };
  if (has(/(away from|not near|avoid) (the )?(toilet|loo|bathroom|lavatory)/)) patch.hard = { ...(patch.hard ?? {}), avoidToilets: true };
  if (has(/together|next to each other|side by side|sit with|معًا|معا|مع بعض|جنب بعض|بجانب بعض/)) patch.together = true;
  if (has(/(don't|dont|do not) need to sit together|can sit apart|separate seats are fine/)) {
    notes.push("Splitting a party is not offered by this prototype; it always keeps the group side by side.");
  }
  const ex = [...(text.toUpperCase().match(/\bNOT (\d{1,2}[A-F])\b/g) ?? [])].map((x) => x.split(" ")[1]);
  if (ex.length) patch.excludeSeats = ex;

  const touched = Object.keys(patch).length > 0;
  // Missing information, asked only when it blocks a search.
  const partyKnown = (patch.setTravellers?.length ?? 0) > 0 || state.travellers.length > 0;
  if (touched && !partyKnown) {
    if (has(/\bwe\b|\bus\b|\bour\b|family|نحن|احنا|عائلتي/))
      return { patch, intent: { kind: "clarify", question: "How many of you are travelling, and is anyone under 16? (I need that before checking seats together and exit-row rules.)" }, notes, injectionAttempt, language };
    patch.setTravellers = [{ type: "adult" }];
    notes.push("Assumed one adult traveller (no party mentioned).");
  }
  if (!touched && !injectionAttempt && has(/\bwe\b|\bus\b|\bour\b|family|نحن|احنا|عائلتي/) && !state.travellers.length)
    return { patch, intent: { kind: "clarify", question: "How many of you are travelling, and is anyone under 16? (I need that before checking seats together and exit-row rules.)" }, notes, injectionAttempt, language };
  if (!touched && !injectionAttempt) {
    if (has(/keep|same|sounds good|ok|okay|thanks/)) return { patch, intent: { kind: "search" }, notes, injectionAttempt, language };
    return { patch, intent: { kind: "unsupported" }, notes, injectionAttempt, language };
  }
  return { patch, intent: { kind: "search" }, notes, injectionAttempt, language };
}
