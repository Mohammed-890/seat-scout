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
async function open(browser: Browser, opts: { w?: number; h?: number; mobile?: boolean; qs?: string; noThree?: boolean } = {}) {
  const ctx = await browser.newContext({ viewport: { width: opts.w ?? 1280, height: opts.h ?? 800 }, isMobile: !!opts.mobile, hasTouch: !!opts.mobile, reducedMotion: "reduce" });
  const page = await ctx.newPage(); const errs = errorsOf(page);
  if (opts.noThree) { await page.route("https://cdn.jsdelivr.net/**", (r) => r.abort("failed")); await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" })); }
  else await local(page);
  await page.goto("http://127.0.0.1:8790/" + (opts.qs ?? "")); await expect(page.locator("#loading")).toHaveClass(/done/);
  return { ctx, page, errs };
}
async function ask(page: Page, text: string) {
  await page.evaluate("isMobile()&&sheetState!=='expanded'&&setSheet('expanded')");
  if (!(await page.locator("#q").isVisible())) await page.click('.tabs [data-t="c"]');
  const before = await page.locator(".msg.bot").count();
  await page.fill("#q", text); await page.click("#send");
  await expect(page.locator(".msg.bot")).toHaveCount(before + 1);
  const msg = page.locator(".msg.bot").nth(before); // a fixed message, not "whichever is last"
  await expect(msg).not.toHaveText(/^Working…/);
  return msg;
}
async function recovery(page: Page, id: string) {
  await page.click("#aboutBtn"); await page.click('.ab nav [data-x="recovery"]'); await page.click(`#${id}`);
  await expect(page.locator(".msg.bot").last()).not.toHaveText(/^Working…/);
}
const FAMILY = "We're two adults travelling with a five-year-old. Our total seat budget is £45. We want to sit together, and I'd prefer a window away from the wing.";

test("adviser: preference shortcut, impossible requests, family seating, preference change, recovery, selection", async ({ page }) => {
  const errs = errorsOf(page);
  await page.goto("/"); await expect(page.locator("#loading")).toHaveClass(/done/);
  await expect(page.locator("#modeText")).toContainText("Rule-based demo: no AI model connected");
  await expect(page.getByRole("heading", { name: "Tell us what makes a good seat for you." })).toBeVisible();
  // a preference shortcut: specific explanation built from the structured fit
  await page.getByRole("button", { name: "I want to sleep." }).click();
  const sleep = page.locator(".msg.bot").first();
  await expect(sleep.locator(".best .ask")).toHaveText("You asked for a window if possible and a quieter zone.");
  await expect(sleep.locator(".best .match")).toContainText("This seat matches both.");
  await expect(sleep.locator(".best .match")).toContainText("The trade-off is");
  // the two previously failing evaluation cases end in an explained no-match that asks before relaxing anything
  const none = await ask(page, "1 adult, window, total £2");
  await expect(none.locator(".nofit")).toContainText("No seat in this sample matches all of your requirements.");
  await expect(none.locator(".nofit")).toContainText("must include a window seat");
  await expect(none.locator(".nofit li").first()).toContainText("raise the total budget");
  await expect(none.locator(".nofit")).toContainText("Which would you like to change?");
  await expect(await ask(page, "لوحدي، مقعد شباك، ميزانية ٣ جنيه")).toContainText("must include a window seat");
  // family: one best recommendation for three adjacent seats, what was asked, total and per-seat prices, details folded
  const fam = await ask(page, FAMILY);
  const best = fam.locator(".best");
  await expect(best).toHaveCount(1);
  await expect(best.locator(".party")).toHaveText("2 adults, 1 child");
  await expect(best.locator(".ask")).toContainText("£45 or less in total");
  await expect(best.locator(".ask")).toContainText("sitting together");
  await expect(best.locator(".best-h")).toContainText("total");
  for (const d of await best.locator("details").all()) expect(await d.getAttribute("open")).toBeNull();
  await best.getByText("Why this seat?").click();
  await expect(best.locator("details").first()).toContainText("not a comfort rating");
  const recs1 = (await page.evaluate("recs")) as string[][];
  for (const g of recs1) expect(g.length).toBe(3);
  expect(await page.locator("#cId").textContent()).toBe(recs1[0][0]);
  // preference change: only the budget changes, other requirements are kept, the earlier card is marked outdated
  const cheaper = await ask(page, "Actually, £25 maximum.");
  const st = (await page.evaluate("lastResult.state")) as any;
  expect(st.budget.totalGBP).toBe(25); expect(st.prefs.window).toBe(1); expect(st.travellers.length).toBe(3); expect(st.together).toBe(true);
  await expect(cheaper.locator(".ask")).toContainText("£25 or less in total");
  await expect(cheaper.locator(".ask")).toContainText("sitting together");
  await expect(best).toHaveClass(/outdated/);
  await expect(best.locator(".flag")).toContainText("Outdated");
  await expect(best.getByRole("button", { name: "Select (demo)" })).toBeDisabled();
  await expect(await ask(page, "Why not row 6?")).toContainText(/row 6/i);
  await ask(page, "I care more about getting out easily.");
  expect(((await page.evaluate("lastResult.state")) as any).prefs.aisle).toBe(2);
  // the trace lives in About, not in the main panel
  await page.click("#aboutBtn"); await page.click('.ab nav [data-x="trace"]');
  await expect(page.locator("#abBody")).toContainText("findAdjacentSeatGroups");
  await expect(page.locator("#abBody")).toContainText("Final validation");
  await page.click("#abClose");
  // availability change: a recommended seat is taken, the card says so and the pick changes
  const top = ((await page.evaluate("recs")) as string[][])[0];
  await recovery(page, "rTaken");
  await expect(page.locator(".msg.bot").last()).toContainText(/was just taken \(availability snapshot v2\)/);
  expect(((await page.evaluate("recs")) as string[][]).flat()).not.toContain(top[0]);
  await recovery(page, "rTimeout");
  const tr = (await page.evaluate("lastResult.trace.map(e=>e.kind)")) as string[];
  expect(tr).toContain("tool_error"); expect(tr).toContain("final");
  await recovery(page, "rImpossible");
  await expect(page.locator(".msg.bot").last().locator(".nofit")).toBeVisible();
  // selection is revalidated by the server, confirmed as a demo, and can be changed
  await ask(page, "Make the total budget £45.");
  const pick = ((await page.evaluate("recs")) as string[][])[0];
  await page.locator(".msg.bot .best:not(.outdated)").last().getByRole("button", { name: "Select (demo)" }).click();
  await expect(page.locator(".msg.bot").last()).toContainText(/nothing has been booked/i);
  await expect(page.locator("#cMine")).toContainText(pick.join(" + "));
  await expect(page.locator("#cMine")).toContainText("Nothing has been booked");
  await page.locator("#cMine").getByRole("button", { name: "Change" }).click();
  await expect(page.locator("#cMine")).toBeHidden();
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
  await page.evaluate("enterSeat('14A','F')");
  await page.locator("#skip").click({ timeout: 20_000 }).catch(() => {}); // the transition may already have finished
  await expect.poll(() => page.evaluate("view"), { timeout: 240_000 }).toBe("F");
  await expect(page.locator('.views button[data-v="AIR"]')).toBeEnabled();
  await expect(page.locator("#resetView")).toBeEnabled();
  expect(errs).toEqual([]);
});

test("seat selection, camera presets, reset view, seat details, explore drawer and comparison", async ({ browser }) => {
  const { ctx, page, errs } = await open(browser);
  expect(await page.evaluate("[typeof PEOPLE, typeof setPlayground, typeof startExitDemo]")).toEqual(["undefined", "undefined", "undefined"]);
  // manual browsing: choose a window seat from the seat chart
  await page.click('.tabs [data-t="m"]'); await page.click('#plan button[data-id="14A"]');
  await expect(page.locator("#cId")).toHaveText("14A");
  await expect(page.locator("#cPos")).toHaveText("Window seat, row 14");
  await expect(page.locator("#cPoints li.pro")).toHaveCount(2);
  await expect(page.locator("#cPoints li.con")).toHaveText("Pass two seats to reach the aisle");
  // measurements stay behind Seat details; pitch is distinguished from usable knee space
  await expect(page.locator("#cFacts")).toBeHidden();
  await page.click("#dDetails summary");
  await expect(page.locator("#cFacts")).toContainText("29″ (74 cm)");
  await expect(page.locator("#cFacts")).toContainText("Row spacing, not the room your knees get");
  await expect(page.locator("#cFacts")).toContainText("Modelled estimate");
  // camera presets
  for (const v of ["F", "W", "L"]) {
    await page.click(`.views button[data-v="${v}"]`);
    await expect.poll(() => page.evaluate("view"), { timeout: 120_000 }).toBe(v);
    await expect(page.locator(`.views button[data-v="${v}"]`)).toHaveAttribute("aria-pressed", "true");
  }
  // reset view restores the preset's angle after looking around
  await page.click('.views button[data-v="W"]');
  expect(await page.evaluate("yaw+=0.6;pitch-=0.2;resetView();Math.abs(yaw-viewAngles(selected,'W').y)<1e-6&&Math.abs(pitch-viewAngles(selected,'W').p)<1e-6")).toBe(true);
  // explore this seat: shade, tray, reading light, recline preview
  await page.click("#dExplore summary");
  for (const k of ["tray", "light", "shade"]) { await page.click(`#exploreBody [data-k="${k}"]`); }
  expect(await page.evaluate("EXPLORE.state().st")).toEqual({ shade: "down", tray: true, light: true });
  await expect(page.locator('#exploreBody [data-k="tray"]')).toHaveAttribute("aria-pressed", "true");
  await page.click('#exploreBody [data-k="recline"]');
  await expect.poll(() => page.evaluate("view")).toBe("R");
  await expect(page.locator("#exploreBody")).toContainText("Space at knee height");
  await page.click("#reclDone");
  await expect.poll(() => page.evaluate("view")).toBe("W");
  // a bulkhead seat has no seat-back tray; an aisle seat has no shade within reach
  await page.evaluate("enterSeat('1C','F')");
  await expect(page.locator('#exploreBody [data-k="tray"]')).toBeDisabled();
  await expect(page.locator('#exploreBody [data-k="shade"]')).toBeDisabled();
  // back to the seat map; reset frames the selected seat again
  await page.click('.views button[data-v="AIR"]');
  await expect.poll(() => page.evaluate("view")).toBe("AIR");
  expect(await page.evaluate("air.az=0.4;resetView();air.az")).toBe(-0.95);
  // taken seats can't be chosen
  const taken = await page.evaluate("Object.values(SEATS).find(s=>s.taken).id");
  await expect(page.locator(`#plan button[data-id="${taken}"]`)).toBeDisabled();
  // comparison of two seats: price difference, access, and choosing a column updates the preview
  await page.click('#plan button[data-id="17C"]');
  await page.click("#cCompare"); await page.click('#plan button[data-id="14A"]');
  await expect(page.locator("#cmp table")).toContainText("17C");
  await expect(page.locator("#cmp table")).toContainText("14A");
  await expect(page.locator("#cmp table")).toContainText("Recline");
  await expect(page.locator("#cmp .key")).toContainText(/£|Same sample price/);
  await page.locator("#cmp th button", { hasText: "14A" }).click();
  await expect(page.locator("#cId")).toHaveText("14A");
  await expect(page.locator("#cmp")).toBeVisible();
  // reduced motion: scenery does not drift
  await page.evaluate("loadModule('scenery')");
  expect(await page.evaluate("typeof SKY !== 'undefined' ? SKY.motion : false")).toBe(false);
  expect(errs).toEqual([]);
  await ctx.close();
});

test("mobile: compact sheet with Find my seat, expands for the adviser, no overlap or overflow", async ({ browser }) => {
  const { ctx, page, errs } = await open(browser, { w: 390, h: 844, mobile: true });
  await expect(page.locator("#panel")).toHaveClass(/compact/);
  const sheet = await page.locator("#panel").boundingBox();
  expect(sheet!.height).toBeLessThan(844 * 0.45);
  const ident = await page.locator(".ident").boundingBox(), presets = await page.locator(".presets").boundingBox(), about = await page.locator("#aboutBtn").boundingBox();
  expect(ident!.y + ident!.height <= presets!.y).toBe(true);
  expect(about!.y + about!.height <= presets!.y).toBe(true);
  expect(presets!.y + presets!.height <= sheet!.y).toBe(true);
  for (const b of await page.locator("#cBtns button:visible").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(40);
  await page.click("#cFind");
  await expect(page.locator("#panel")).not.toHaveClass(/compact/);
  await expect(page.getByRole("button", { name: "I need more space." })).toBeVisible();
  const r = await ask(page, "2 adults, total £20, together");
  await expect(r.locator(".best")).toHaveCount(1);
  await r.locator(".best").getByRole("button", { name: "View seat" }).click();
  await expect(page.locator("#panel")).toHaveClass(/compact/);
  expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
  expect(errs).toEqual([]);
  await ctx.close();
});

test("without WebGL: 2D chart and adviser still work on mobile", async ({ browser }) => {
  const { ctx, page, errs } = await open(browser, { w: 390, h: 844, mobile: true, qs: "?no3d" });
  await expect(page.locator(".flat-note")).toContainText("isn't available on this device");
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

test("loading failure: if the 3D library can't load, the 2D fallback takes over", async ({ browser }) => {
  const { ctx, page, errs } = await open(browser, { noThree: true });
  await expect(page.locator(".flat-note")).toContainText("couldn't load");
  await expect(page.locator(".presets")).toBeHidden();
  await page.click('.tabs [data-t="m"]'); await page.click('#plan button[data-id="17C"]');
  await expect(page.locator("#cId")).toHaveText("17C");
  const r = await ask(page, "I want to leave quickly.");
  await expect(r.locator(".best .ask")).toContainText("easy access to the aisle");
  expect(errs).toEqual([]);
  await ctx.close();
});
