import { defineConfig } from "@playwright/test";
// End-to-end test of the passenger journey against the real server in deterministic mode (no API key).
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 600_000,
  expect: { timeout: 120_000 },
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:8790",
    viewport: { width: 1280, height: 800 },
    launchOptions: { executablePath: process.env.PW_CHROMIUM || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
  },
  webServer: { command: "SEAT_SCOUT_MODE=deterministic PORT=8790 npx tsx src/server/index.ts", url: "http://127.0.0.1:8790/", reuseExistingServer: false, timeout: 60_000 },
});
