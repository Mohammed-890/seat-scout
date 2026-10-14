import { test, expect, type Page, type Browser } from "@playwright/test";
import { readFileSync } from "node:fs";

/* End-to-end checks against the real server in deterministic mode (no API key), rendered with software WebGL
   (SwiftShader). Timings here are not representative of a GPU, so tests wait on state, not time. Seat-view
   checks use reduced motion, where camera moves complete immediately. */
const local = async (page: Page) => {
  await page.route("https://cdn.jsdelivr.net/npm/three@0.147.0/**", (r) => r.fulfill({ body: readFileSync(`node_modules/three/${r.request().url().split("three@0.147.0/")[1]}`, "utf8"), contentType: "application/javascript" }));
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
};
test.beforeEach(async ({ page }) => { await local(page); });
const errorsOf = (page: Page) => { const errs: string[] = []; page.on("pageerror", (e) => errs.push(String(e))); return errs; };
async function open(browser: Browser, opts: { w?: number; h?: number; mobile?: boolean; qs?: string } = {}) {
  const ctx = await browser.newContext({ viewport: { width: opts.w ?? 1280, height: opts.h ?? 800 }, isMobile: !!opts.mobile, hasTouch: !!opts.mobile, reducedMotion: "reduce" });
  const page = await ctx.newPage(); await local(page); const errs = errorsOf(page);
  await page.goto("http://127.0.0.1:8790/" + (opts.qs ?? "")); await expect(page.locator("#loading")).toHaveClass(/done/);
  return { ctx, page, errs };
}
async function ask(page: Page, text: string) {
  await page.evaluate("isMobile()&&sheetState!=='expanded'&&setSheet('expanded')");
  if (!(await page.locator("#q").isVisible())) await page.click('.tabs [data-t="c"]');
  const before = await page.locator(".msg.bot").count();
  await page.fill("#q", text); await page.click("#send");
  await expect(page.locator(".msg.bot")).toHaveCount(before + 1);
  await expect(page.locator(".msg.bot").last()).not.toHaveText(/^Working…/);
  return page.locator(".msg.bot").last();
}
async function recovery(page: Page, id: string) {
  await page.click("#aboutBtn"); await page.click('.ab nav [data-x="recovery"]'); await page.click(`#${id}`);
  await expect(page.locator(".msg.bot").last()).not.toHaveText(/^Working…/);
}
const FAMILY = "We're two adults travelling with a five-year-old. Our total seat budget is £45. We want to sit together, and I'd prefer a window away from the wing.";

test("assistant: known failures, family seating, budget change, outdated cards, recovery, selection", async ({ page }) => {
  const errs = errorsOf(page);
  await page.goto("/"); await expect(page.locator("#loading")).toHaveClass(/done/);
  await expect(page.locator("#modeText")).toContainText("rule-based mode, no AI model connected");
  // the two previously failing evaluation cases: a named window seat is a requirement
  await expect(await ask(page, "1 adult, window, total £2")).toContainText("Nothing in the current snapshot satisfies all of");
  await expect(page.locator(".msg.bot").last().locator(".best")).toHaveCount(0);
  await expect(await ask(page, "لوحدي، مقعد شباك، ميزانية ٣ جنيه")).toContainText("must include a window seat");
  // family: one best recommendation, three adjacent seats, total and per-seat prices, alternatives folded away
  const fam = await ask(page, FAMILY);
  const best = fam.locator(".best");
  await expect(best).toHaveCount(1);
  await expect(best.locator(".reqs")).toContainText("2 adults, 1 child");
  await expect(best.locator(".reqs")).toContainText("no exit rows with children");
  await expect(best.locator(".best-h")).toContainText("total");
  await expect(best.getByRole("button", { name: "View seat" })).toBeVisible();
  for (const d of await best.locator("details").all()) expect(await d.getAttribute("open")).toBeNull();
  const recs1 = (await page.evaluate("recs")) as string[][];
  for (const g of recs1) expect(g.length).toBe(3);
  expect(await page.locator("#cId").textContent()).toBe(recs1[0][0]);
  // budget change: only that field changes; the earlier card is marked outdated and can no longer be selected
  await expect(await ask(page, "Actually, £25 maximum.")).toContainText("£25");
  const st = (await page.evaluate("lastResult.state")) as any;
  expect(st.budget.totalGBP).toBe(25); expect(st.prefs.window).toBe(1); expect(st.travellers.length).toBe(3);
  await expect(best).toHaveClass(/outdated/);
  await expect(best.locator(".flag")).toContainText("Outdated");
  await expect(best.getByRole("button", { name: "Select (demo)" })).toBeDisabled();
  await expect(await ask(page, "Why not row 6?")).toContainText(/row 6/i);
  await expect(await ask(page, "I care more about getting out easily.")).not.toContainText("Something went wrong");
  expect(((await page.evaluate("lastResult.state")) as any).prefs.aisle).toBe(2);
  // the trace lives in About, not in the main panel
  await page.click("#aboutBtn"); await page.click('.ab nav [data-x="trace"]');
  await expect(page.locator("#abBody")).toContainText("findAdjacentSeatGroups");
  await expect(page.locator("#abBody")).toContainText("Final validation");
  await page.click("#abClose");
  // availability change: a recommended seat is taken and the recommendation is revalidated
  const top = ((await page.evaluate("recs")) as string[][])[0];
  await recovery(page, "rTaken");
  await expect(page.locator(".msg.bot").last()).toContainText(/availability snapshot v2/);
  expect(((await page.evaluate("recs")) as string[][]).flat()).not.toContain(top[0]);
  // a tool timeout is recovered from, and the trace shows it
  await recovery(page, "rTimeout");
  const tr = (await page.evaluate("lastResult.trace.map(e=>e.kind)")) as string[];
  expect(tr).toContain("tool_error"); expect(tr).toContain("final");
  // impossible request
  await recovery(page, "rImpossible");
  await expect(page.locator(".msg.bot").last()).toContainText("Nothing in the current snapshot");
  // selection is revalidated by the server and nothing is booked
  await expect(await ask(page, "Make the total budget £45.")).not.toContainText("Something went wrong");
  const pick = ((await page.evaluate("recs")) as string[][])[0];
  await page.locator(".msg.bot .best:not(.outdated)").last().getByRole("button", { name: "Select (demo)" }).click();
  await expect(page.locator(".msg.bot").last()).toContainText(/nothing has been booked/i);
  await expect(page.locator("#cMine")).toContainText(pick.join(" + "));
  expect(errs).toEqual([]);
});

test("no duplicate submissions while a request runs; failed messages keep a retry", async ({ page }) => {
  const errs = errorsOf(page);
  let chats = 0; page.on("request", (r) => { if (r.url().endsWith("/api/chat")) chats++; });
  await page.goto("/"); await expect(page.locator("#loading")).toHaveClass(/done/);
  await page.fill("#q", "2 adults, total £20, together");
  await page.evaluate("send(); qEl.value='2 adults, total £20, together'; send(); document.getElementById('send').click()");
  await expect(page.locator(".msg.bot").last()).not.toHaveText(/^Working…/);
  expect(chats).toBe(1);
  await page.route("**/api/chat", (r) => r.abort("failed"), { times: 1 });
  await page.fill("#q", "Cheaper."); await page.click("#send");
  await expect(page.locator(".msg.bot.failed").last()).toBeVisible();
  await page.locator(".msg.bot.failed").last().getByRole("button", { name: "Retry" }).click();
  await expect(page.locator(".msg.bot").last()).not.toHaveClass(/failed/);
  await expect(page.locator("#send")).toBeEnabled();
  expect(errs.filter((e) => !/Failed to fetch|NetworkError/.test(e))).toEqual([]);
});

test("camera interruption: going back mid-transition never leaves controls disabled", async ({ page }) => {
  const errs = errorsOf(page);
  await page.goto("/"); await expect(page.locator("#loading")).toHaveClass(/done/);
  await page.evaluate("ui.select('14A');enterSeat('14A','F');backToAircraft()");
  await expect.poll(() => page.evaluate("view"), { timeout: 240_000 }).toBe("AIR");
  await expect(page.locator('.views button[data-v="F"]')).toBeEnabled();
  await page.evaluate("enterSeat('14A','F')"); await page.click("#skip").catch(() => {});
  await expect.poll(() => page.evaluate("view"), { timeout: 240_000 }).toBe("F");
  await expect(page.locator('.views button[data-v="AIR"]')).toBeEnabled();
  expect(errs).toEqual([]);
});

test("seat selection, views and key details; no characters or playground remain", async ({ browser }) => {
  const { ctx, page, errs } = await open(browser);
  expect(await page.evaluate("[typeof PEOPLE, typeof RIG, typeof setPlayground, typeof startExitDemo]")).toEqual(["undefined", "undefined", "undefined", "undefined"]);
  await expect(page.locator("#ctrlBar, #playPanel, #exitPanel, #sceneBtn")).toHaveCount(0);
  // choose a window seat from the seat map
  await page.click('.tabs [data-t="m"]'); await page.click('#plan button[data-id="14A"]');
  await expect(page.locator("#cId")).toHaveText("14A");
  await expect(page.locator("#cFacts")).toContainText("Seat pitch");
  await expect(page.locator("#cFacts")).toContainText(/\d+ in \/ \d+ cm/);
  await expect(page.locator("#cFacts")).toContainText("You would pass two seats to reach the aisle.");
  await expect(page.locator("#cPrice")).toHaveText(/£\d+|Free/);
  // views: from the seat, the window and legroom
  for (const v of ["F", "W", "L"]) {
    await page.click(`.views button[data-v="${v}"]`);
    await expect.poll(() => page.evaluate("view"), { timeout: 120_000 }).toBe(v);
    await expect(page.locator(`.views button[data-v="${v}"]`)).toHaveAttribute("aria-pressed", "true");
  }
  await expect(page.locator("#space")).toBeVisible();
  await expect(page.locator("#spaceSum")).toContainText("estimate");
  await page.click('.views button[data-v="AIR"]');
  await expect.poll(() => page.evaluate("view"), { timeout: 120_000 }).toBe("AIR");
  await expect(page.locator("#space")).toBeHidden();
  // an aisle seat is direct; a taken seat cannot be chosen
  await page.click('#plan button[data-id="17C"]');
  await expect(page.locator("#cFacts")).toContainText("Direct: this is an aisle seat.");
  const taken = await page.evaluate("Object.values(SEATS).find(s=>s.taken).id");
  await expect(page.locator(`#plan button[data-id="${taken}"]`)).toBeDisabled();
  // comparison stays a small secondary table
  await page.click("#cCompare"); await page.evaluate("ui.select('14A')");
  await expect(page.locator("#cmp table")).toContainText("17C");
  await expect(page.locator("#cmp table")).toContainText("14A");
  // reduced motion: scenery does not drift
  await page.evaluate("loadModule('scenery')");
  expect(await page.evaluate("typeof SKY !== 'undefined' ? SKY.motion : false")).toBe(false);
  expect(errs).toEqual([]);
  await ctx.close();
});

test("mobile: compact bottom sheet that expands for the assistant, no overlap or overflow", async ({ browser }) => {
  const { ctx, page, errs } = await open(browser, { w: 390, h: 844, mobile: true });
  await expect(page.locator("#panel")).toHaveClass(/compact/);
  const sheet = await page.locator("#panel").boundingBox();
  expect(sheet!.height).toBeLessThan(844 * 0.45);
  const about = await page.locator("#aboutBtn").boundingBox(), views = await page.locator(".views").boundingBox();
  expect(about!.y + about!.height <= views!.y || views!.x >= about!.x + about!.width).toBe(true);
  expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
  const r = await ask(page, "2 adults, total £20, together");
  await expect(r.locator(".best")).toHaveCount(1);
  await expect(page.locator("#panel")).not.toHaveClass(/compact/);
  // "View seat" returns to the compact sheet so the view is visible
  await r.locator(".best").getByRole("button", { name: "View seat" }).click();
  await expect(page.locator("#panel")).toHaveClass(/compact/);
  expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
  expect(errs).toEqual([]);
  await ctx.close();
});

test("rendering fallback without WebGL on mobile: seat map and assistant still work", async ({ browser }) => {
  const { ctx, page, errs } = await open(browser, { w: 390, h: 844, mobile: true, qs: "?no3d" });
  await expect(page.locator(".flat-note")).toBeVisible();
  await expect(page.locator("#plan button[data-id]").first()).toBeAttached();
  const r = await ask(page, "2 adults, total £20, together");
  await expect(r.locator(".best").first()).toBeAttached();
  expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
  await page.focus("#q");
  const box = await page.locator("#q").boundingBox();
  expect(box && box.y + box.height <= 844).toBe(true);
  expect(errs).toEqual([]);
  await ctx.close();
});
