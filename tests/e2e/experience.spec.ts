import { test, expect, type Page } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

/* Verification list from the brief, run against the real server in deterministic mode with software WebGL
   (SwiftShader). Timings in this environment are not representative of a GPU, so tests wait on state, not time. */
test.beforeEach(async ({ page }) => {
  await page.route("https://cdn.jsdelivr.net/npm/three@0.147.0/**", (r) => {
    const rel = r.request().url().split("three@0.147.0/")[1];
    r.fulfill({ body: readFileSync(`node_modules/three/${rel}`, "utf8"), contentType: "application/javascript" });
  });
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
});
const errorsOf = (page: Page) => { const errs: string[] = []; page.on("pageerror", (e) => errs.push(String(e))); return errs; };
async function ask(page: Page, text: string) {
  if (!(await page.locator("#q").isVisible())) await page.click('.tabs [data-t="c"]');
  const before = await page.locator(".msg.bot").count();
  await page.fill("#q", text); await page.click("#send");
  await expect(page.locator(".msg.bot")).toHaveCount(before + 1);
  await expect(page.locator(".msg.bot").last()).not.toHaveText(/^Working…/);
  return page.locator(".msg.bot").last();
}

test("concierge: known failures, family, impossible, Arabic, multi-turn, availability, timeout, compare, select", async ({ page }) => {
  const errs = errorsOf(page);
  await page.goto("/"); await expect(page.locator("#loading")).toHaveClass(/done/);
  // the two previously failing eval cases
  await expect(await ask(page, "1 adult, window, total £2")).toContainText("Nothing in the current snapshot satisfies all of");
  await expect(page.locator(".msg.bot").last().locator(".rec")).toHaveCount(0);
  await expect(await ask(page, "لوحدي، مقعد شباك، ميزانية ٣ جنيه")).toContainText("must include a window seat");
  // single passenger
  const single = await ask(page, "1 adult, aisle near the front, total £25");
  await expect(single.locator(".rec").first()).toBeVisible();
  // family request (new session state: party set explicitly)
  const fam = await ask(page, "We're two adults travelling with a five-year-old. Our total seat budget is £45. We want to sit together, and I'd prefer a window away from the wing.");
  await expect(fam.locator(".rec").first()).toBeVisible();
  const recs1 = (await page.evaluate("recs")) as string[][];
  for (const g of recs1) expect(g.length).toBe(3);
  // per-seat prices separate from the group total
  await expect(fam.locator(".rec").first()).toContainText("group total");
  await expect(fam.locator(".rec").first()).toContainText("Per seat:");
  // scene actions are present on the card
  for (const t of ["View these seats", "Compare the alternative", "Try getting out", "Preview the available space"]) await expect(fam.locator(".rec").first().getByRole("button", { name: t })).toBeVisible();
  // multi-turn: only the named field changes
  await expect(await ask(page, "Actually, £25 maximum.")).toContainText("£25");
  const st = (await page.evaluate("lastResult.state")) as any;
  expect(st.budget.totalGBP).toBe(25); expect(st.prefs.window).toBe(1); expect(st.travellers.length).toBe(3);
  await expect(await ask(page, "Why not row 6?")).toContainText(/row 6/i);
  const easy = await ask(page, "I care more about getting out easily.");
  expect(((await page.evaluate("lastResult.state")) as any).prefs.aisle).toBe(2);
  await expect(easy).not.toContainText("Something failed");
  // availability change: a recommended seat is taken, recommendation is revalidated
  const top = ((await page.evaluate("recs")) as string[][])[0];
  await page.click('.tabs [data-t="e"]'); await page.click("#dTaken");
  await expect(page.locator(".msg.bot").last()).toContainText(/availability snapshot v2/);
  expect(((await page.evaluate("recs")) as string[][]).flat()).not.toContain(top[0]);
  // tool timeout recovery (one timed-out tool call, then a retry that succeeds)
  await page.click("#dTimeout");
  await expect(page.locator(".msg.bot").last()).not.toHaveText(/^Working…/);
  const tr = (await page.evaluate("lastResult.trace.map(e=>e.kind)")) as string[];
  expect(tr).toContain("tool_error"); expect(tr).toContain("final");
  // live progress came from real events
  await expect(page.locator("#liveProg")).toContainText("Finished");
  // impossible budget
  await page.click("#dImpossible");
  await expect(page.locator(".msg.bot").last()).toContainText("Nothing in the current snapshot");
  // comparison and selection agree with the dataset
  await expect(await ask(page, "Make the total budget £45.")).not.toContainText("Something failed");
  const pick = ((await page.evaluate("recs")) as string[][])[0];
  await page.click('.tabs [data-t="c"]');
  await page.locator(".msg.bot").last().locator(".rec").first().getByRole("button", { name: "Select (demo)" }).click();
  await expect(page.locator(".msg.bot").last()).toContainText(/nothing has been booked/i);
  await expect(page.locator("#mineId")).toHaveText(pick.join("+"));
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
  // simulate a dropped connection: the message stays, with a Retry using the same request id
  await page.route("**/api/chat", (r) => r.abort("failed"), { times: 1 });
  await page.fill("#q", "Cheaper."); await page.click("#send");
  await expect(page.locator(".msg.bot.failed").last()).toBeVisible();
  await page.locator(".msg.bot.failed").last().getByRole("button", { name: "Retry" }).click();
  await expect(page.locator(".msg.bot").last()).not.toHaveClass(/failed/);
  await expect(page.locator("#send")).toBeEnabled();
  expect(errs.filter((e) => !/Failed to fetch|NetworkError/.test(e))).toEqual([]);
});

test("cabin objects, recline preview, camera interruption, playground and aisle demo", async ({ page }) => {
  const errs = errorsOf(page);
  await page.goto("/"); await expect(page.locator("#loading")).toHaveClass(/done/);
  // camera interruption: start the transition and immediately go back; controls must not stay disabled
  await page.evaluate("ui.select('14A');enterSeat('14A','F');backToAircraft()");
  await expect.poll(() => page.evaluate("view")).toMatch(/AIR|T/);
  await expect.poll(() => page.evaluate("view"), { timeout: 240_000 }).toBe("AIR");
  await expect(page.locator('.views button[data-v="F"]')).toBeEnabled();
  // sit in 14A (window): only supported features are offered
  await page.evaluate("enterSeat('14A','F')");
  await expect.poll(() => page.evaluate("view"), { timeout: 240_000 }).toBe("F");
  await expect(page.locator("#ctrlBar")).toBeVisible();
  const sup = (await page.evaluate("RIG.sup")) as any;
  expect(sup.shade).toBe(true); expect(sup.armL).toBe(false); expect(sup.armR).toBe(true); expect(sup.tray).toBe(true);
  for (const [k, key] of [["tray", "t"], ["shade", "s"], ["light", "l"], ["belt", "b"], ["armR", "]"]] as const) {
    await page.keyboard.press(key);
    await expect.poll(() => page.evaluate(`TW.list.length`), { timeout: 30_000 }).toBe(0);
  }
  const st = (await page.evaluate("RIG.st")) as any;
  expect(st.tray).toBe(true); expect(st.shade).toBe("down"); expect(st.light).toBe(true); expect(st.belt).toBe(0); expect(st.armR).toBe(true);
  await expect(page.locator('#ctrlBar [data-k="tray"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('#ctrlBar [data-k="armL"]')).toHaveAttribute("aria-disabled", "true");
  // recline preview shows the effect behind, then returns to the seat
  await page.keyboard.press("r");
  await expect(page.locator("#reclineInfo")).toBeVisible();
  await expect(page.locator("#reclineInfo")).toContainText("Modelled space at knee height");
  await page.click("#reclineDone");
  await expect.poll(() => page.evaluate("view"), { timeout: 240_000 }).toBe("F");
  // Playground: passengers appear; a shove wobbles within bounds and everyone recovers in place
  await page.click("#sceneBtn"); await page.click("#playSw");
  await expect.poll(() => page.evaluate("window.PEOPLE ? PEOPLE.list.length : 0"), { timeout: 60_000 }).toBeGreaterThan(1);
  await expect(page.locator("#playPanel")).toBeVisible();
  await page.evaluate("playAction('shove')");
  for (let i = 0; i < 6; i++) { expect(await page.evaluate("peopleCheck()")).toEqual([]); await page.waitForTimeout(400); }
  await page.evaluate("playAction('tap')"); await page.waitForTimeout(1500);
  await page.evaluate("resetAll()");
  expect(await page.evaluate("peopleCheck()")).toEqual([]);
  // aisle access: two people must stand at 29 in pitch, then everything resets
  await page.evaluate("startExitDemo()");
  await expect(page.locator("#exitPanel")).toBeVisible();
  await page.click("#exSkip");
  await expect(page.locator("#exitPanel")).toContainText("2 people to pass");
  await expect(page.locator("#exitPanel")).toContainText("Seat pitch: 29 in / 74 cm");
  expect(await page.evaluate("peopleCheck()")).toEqual([]);
  await page.click("#exReset");
  await expect.poll(() => page.evaluate("view"), { timeout: 30_000 }).toBe("F");
  // performance numbers measured in this (software-rendered) browser
  const perf = await page.evaluate("PERF.stats()");
  mkdirSync("test-results", { recursive: true }); writeFileSync("test-results/perf-swiftshader.json", JSON.stringify(perf, null, 1));
  expect(errs).toEqual([]);
});

test("rendering fallback without WebGL and no horizontal overflow on mobile", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  const page = await ctx.newPage(); const errs = errorsOf(page);
  await page.route("https://cdn.jsdelivr.net/npm/three@0.147.0/**", (r) => r.fulfill({ body: readFileSync(`node_modules/three/${r.request().url().split("three@0.147.0/")[1]}`, "utf8"), contentType: "application/javascript" }));
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
  await page.goto("http://127.0.0.1:8790/?no3d");
  await expect(page.locator("#loading")).toHaveClass(/done/);
  await expect(page.locator(".flat-note")).toBeVisible();
  await expect(page.locator("#plan .seat").first()).toBeAttached();
  const r = await ask(page, "2 adults, total £20, together");
  await expect(r.locator(".rec").first()).toBeAttached();
  expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
  // the composer is reachable and inside the viewport once focused
  await page.focus("#q");
  const box = await page.locator("#q").boundingBox();
  expect(box && box.y + box.height <= 844).toBe(true);
  expect(errs).toEqual([]);
  await ctx.close();
});

test("reduced motion: seat transitions complete immediately", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const page = await ctx.newPage(); const errs = errorsOf(page);
  await page.route("https://cdn.jsdelivr.net/npm/three@0.147.0/**", (r) => r.fulfill({ body: readFileSync(`node_modules/three/${r.request().url().split("three@0.147.0/")[1]}`, "utf8"), contentType: "application/javascript" }));
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
  await page.goto("http://127.0.0.1:8790/"); await expect(page.locator("#loading")).toHaveClass(/done/);
  expect(await page.evaluate("ui.select('20C');enterSeat('20C','F');view")).toBe("F");
  expect(await page.evaluate("act('tray');RIG.st.tray")).toBe(true);
  expect(await page.evaluate("TW.list.length")).toBe(0);
  expect(await page.evaluate("typeof SKY !== 'undefined' ? SKY.motion : false")).toBe(false);
  expect(errs).toEqual([]);
  await ctx.close();
});
