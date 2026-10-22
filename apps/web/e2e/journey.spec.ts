import { test, expect } from "@playwright/test";
test("benchmark queues in UI and exposes persisted case results", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  const menu = page.getByRole("button", {
    name: "Toggle navigation",
    exact: true,
  });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New project", exact: true });
  await dialog
    .getByRole("textbox", { name: "Name", exact: true })
    .fill(`Benchmark ${Date.now()}`);
  await dialog
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("tab", { name: "Evaluations", exact: true }).click();
  await page
    .getByRole("button", { name: "Run benchmark", exact: true })
    .click();
  await expect(page.locator(".benchmark-job")).toBeVisible();
  await expect(page.locator(".benchmark-job .status-badge")).toHaveText(
    "completed",
    { timeout: 90000 },
  );
  await expect(page.locator(".benchmark-job")).toContainText("15 / 15 cases");
  await page.getByText("Inspect 15 case results", { exact: true }).click();
  await expect(page.locator(".evaluation")).toContainText("security-synthesis");
  await expect(page.locator(".evaluation")).toContainText(
    "Reproducibility manifest",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});
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
  await expect(page.locator(".run-strip .status-badge.completed")).toBeVisible({
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
  const errorBanner = page.locator(".error-banner");
  await expect(errorBanner).toBeVisible();
  await expect(errorBanner).toContainText("seeded questions");
});
