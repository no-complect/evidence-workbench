import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./supabase-e2e",
  timeout: 180_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.WORKBENCH_WEB_URL,
    // Auth callbacks contain local tokens. Do not retain browser state or traces.
    trace: "off",
    screenshot: "off",
    video: "off",
    actionTimeout: 15_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
});
