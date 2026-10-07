import { test, expect } from "@playwright/test";
test("seeded question → edited plan → report → citation → context → export", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Start research", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "A plan before we proceed" }),
  ).toBeVisible({ timeout: 30000 });
  await page
    .getByLabel("security research question")
    .fill("security retention current requirements");
  await page.getByRole("button", { name: "Approve & investigate" }).click();
  await expect(page.locator(".status-badge.completed")).toBeVisible({
    timeout: 60000,
  });
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath("demo-report.png"),
    fullPage: true,
  });
  await expect(
    page.getByRole("heading", {
      name: /enterprise ai assistant.*evidence review/i,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Open citation/ })
    .first()
    .click();
  await expect(
    page.getByRole("dialog", { name: "Evidence details" }),
  ).toBeVisible();
  await expect(page.locator(".provenance")).toContainText("Version");
  await page.keyboard.press("Escape");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe("research-report.md");
  await page.getByRole("tab", { name: "Context", exact: true }).click();
  await expect(page.locator(".code-header")).toContainText("Assembled input");
  await page.getByRole("tab", { name: "Activity", exact: true }).click();
  await expect(page.getByText("Report ready", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});
test("upload ingestion status and arbitrary demo error are visible", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Sources", exact: true }).click();
  await page.getByLabel("Upload source file").setInputFiles({
    name: "browser-test.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Security requirements: all source access must be scoped to the selected project. Synthetic test upload.",
    ),
  });
  await expect(
    page.getByText("browser-test.txt", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", {
      name: "What would you like to investigate?",
      exact: true,
    })
    .fill("Tell me the actual current vendor prices.");
  await page
    .getByRole("button", { name: "Start research", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("seeded questions");
});
