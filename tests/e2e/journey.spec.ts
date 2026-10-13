import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

// Serve three.js locally so the test works offline (the app loads it from the jsDelivr CDN).
test.beforeEach(async ({ page }) => {
  await page.route("https://cdn.jsdelivr.net/npm/three@0.147.0/**", (r) => {
    const rel = r.request().url().split("three@0.147.0/")[1];
    r.fulfill({ body: readFileSync(`node_modules/three/${rel}`, "utf8"), contentType: "application/javascript" });
  });
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
  await page.addStyleTag({ content: "" }).catch(() => {});
});

test("core journey: request → validated group → budget change → seat taken → recovery", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  await expect(page.locator("#loading")).toHaveClass(/done/);
  await expect(page.locator("#modeText")).toContainText("Deterministic");

  await page.fill("#q", "We're two adults travelling with a five-year-old. Our total seat budget is £45. We want to sit together, and I'd prefer a window away from the wing.");
  await page.click("#send");
  const firstCard = page.locator(".msg.bot .rec").first();
  await expect(firstCard).toBeVisible();
  const seats1 = await page.evaluate("recs") as string[][];
  expect(seats1.length).toBeGreaterThan(0);
  for (const g of seats1) expect(g.length).toBe(3);
  // highlighted (recs), selected seat and card agree
  expect(await page.locator("#cId").textContent()).toBe(seats1[0][0]);
  await page.screenshot({ path: "test-results/e2e-1-recommendation.png" });

  await page.fill("#q", "Actually, £25 maximum.");
  await page.click("#send");
  await expect(page.locator(".msg.bot").last()).toContainText(/£25/);

  await page.click('.tabs [data-t="e"]');
  await expect(page.locator("#trace .ev").first()).toBeVisible();
  await expect(page.locator("#trace")).toContainText("findAdjacentSeatGroups");
  await expect(page.locator("#trace")).toContainText("Final validation");

  await page.click("#dTaken");
  await expect(page.locator(".msg.bot").last()).toContainText(/was just taken \(availability snapshot v2\)/);
  const seats2 = await page.evaluate("recs") as string[][];
  expect(seats2.flat()).not.toContain(seats1[0][0]);
  await page.screenshot({ path: "test-results/e2e-2-recovery.png" });

  await page.click("#dImpossible");
  await expect(page.locator(".msg.bot").last()).toContainText(/Nothing in the current snapshot/);
  expect(errors).toEqual([]);
});
