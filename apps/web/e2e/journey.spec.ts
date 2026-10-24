import { test, expect } from "@playwright/test";
test("benchmark queues in UI and exposes persisted case results", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
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
  await page.getByRole("button", { name: "Evaluations", exact: true }).click();
  await page
    .getByRole("button", { name: "Run benchmark", exact: true })
    .click();
  await expect(page.locator(".benchmark-job")).toBeVisible();
  const running = page.getByRole("button", {
    name: "Evaluation in progress",
    exact: true,
  });
  await expect(running).toBeDisabled();
  await expect(running).toHaveAttribute("aria-busy", "true");
  await expect(page.locator(".benchmark-job .status-badge")).toHaveText(
    "completed",
    { timeout: 90000 },
  );
  await expect(page.locator(".benchmark-job")).toContainText("15 / 15 cases");
  await expect(
    page.getByRole("button", { name: "Run benchmark", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Run benchmark", exact: true }),
  ).toHaveAttribute("aria-busy", "false");
  const jobs = page.getByRole("region", {
    name: "Evaluation jobs",
    exact: true,
  });
  const comparisons = page.getByRole("region", {
    name: "Evaluation comparisons",
    exact: true,
  });
  const suite = page.getByRole("region", {
    name: "Evaluation suite",
    exact: true,
  });
  const measurements = page.getByRole("region", {
    name: "Evaluation measurements",
    exact: true,
  });
  const widths =
    info.project.name === "desktop" ? [360, 768, 900, 1280, 1920] : [390, 844];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    const [
      jobBox,
      comparisonBox,
      suiteBox,
      measurementsBox,
      headingBox,
      iconBox,
    ] = await Promise.all([
      jobs.boundingBox(),
      comparisons.boundingBox(),
      suite.boundingBox(),
      measurements.boundingBox(),
      comparisons
        .getByRole("heading", { name: "Evaluation comparisons", exact: true })
        .boundingBox(),
      comparisons.locator("header > svg").boundingBox(),
    ]);
    expect(
      comparisonBox!.y - (jobBox!.y + jobBox!.height),
    ).toBeGreaterThanOrEqual(24);
    expect(Math.abs(comparisonBox!.x - jobBox!.x)).toBeLessThan(2);
    expect(Math.abs(iconBox!.y - headingBox!.y)).toBeLessThan(5);
    const available = await suite.evaluate(
      (el) => el.parentElement!.clientWidth,
    );
    if (available >= 740) {
      expect(Math.abs(suiteBox!.y - measurementsBox!.y)).toBeLessThan(2);
      expect(
        measurementsBox!.x - (suiteBox!.x + suiteBox!.width),
      ).toBeGreaterThanOrEqual(18);
    } else {
      expect(
        measurementsBox!.y - (suiteBox!.y + suiteBox!.height),
      ).toBeGreaterThanOrEqual(18);
    }
    const time = comparisons.locator("time").first();
    expect(
      await time.evaluate(
        (el) =>
          el.getBoundingClientRect().right <=
          el.parentElement!.getBoundingClientRect().right + 1,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`evaluation-layout-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize(info.project.use.viewport!);
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
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
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
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Execution configuration", exact: true }),
  ).toContainText("Deterministic fixture");
  await page.screenshot({
    path: testInfo.outputPath("harness.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "RAG", exact: true }).click();
  await expect(page.getByLabel("Upload source file")).toBeAttached();
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  await expect(page.getByLabel("security research question")).toHaveValue(
    "security retention current requirements",
  );
  await page.getByRole("button", { name: "Approve & investigate" }).click();
  await expect(page.locator(".run-strip .status-badge.completed")).toBeVisible({
    timeout: 60000,
  });
  await expect(page.locator(".run-strip")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "A plan before we proceed" }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Decision brief", exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath("demo-report.png"),
    fullPage: true,
  });
  await expect(
    page.getByRole("heading", {
      name: /enterprise ai assistant.*evidence review/i,
    }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Evidence board", exact: true }).click();
  const findings = page.getByRole("group", {
    name: "Research findings",
    exact: true,
  });
  await expect(findings).toBeVisible();
  await findings.getByRole("button").first().click();
  const selectedEvidence = page.getByRole("region", {
    name: "Selected evidence",
    exact: true,
  });
  await expect(selectedEvidence).toContainText("Version");
  await page.screenshot({
    path: testInfo.outputPath("evidence-board.png"),
    fullPage: true,
  });
  await selectedEvidence
    .getByRole("button", { name: "Inspect provenance", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Evidence details" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await findings
    .getByRole("button", { name: /LIMITATION/ })
    .first()
    .click();
  await expect(selectedEvidence).toContainText("Preserve this limitation");
  await page.getByRole("tab", { name: "Decision brief", exact: true }).click();
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
  const contextPanel = page.getByRole("tabpanel", {
    name: "Context",
    exact: true,
  });
  const modelCall = contextPanel.getByRole("combobox", {
    name: "Model call",
    exact: true,
  });
  const reportContext = await modelCall
    .locator("option")
    .filter({ hasText: "report/" })
    .first()
    .getAttribute("value");
  expect(reportContext).toBeTruthy();
  await modelCall.selectOption(reportContext!);
  await expect(
    contextPanel.getByRole("region", {
      name: "User requirements",
      exact: true,
    }),
  ).toBeVisible();
  await contextPanel
    .getByText("Read saved instructions", { exact: true })
    .click();
  await expect(
    contextPanel.getByRole("region", {
      name: "Trusted instructions",
      exact: true,
    }),
  ).toContainText("saved prompt");
  const contextSources = contextPanel.getByRole("region", {
    name: "Retrieved passages in model context",
    exact: true,
  });
  const contextVersion = await contextSources
    .locator("dl")
    .first()
    .locator("dt")
    .filter({ hasText: "Source version" })
    .evaluate((node) => node.nextElementSibling?.textContent);
  expect(contextVersion).toBeTruthy();
  expect(contextVersion).not.toBe("Not available in this run");
  await contextSources
    .getByRole("button", { name: "Inspect source", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("dialog", { name: "Evidence details", exact: true }),
  ).toContainText(contextVersion!);
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(() => document.body.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("context-inspector.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  const embedded = page.getByRole("region", {
    name: "Harness workspace",
    exact: true,
  });
  await embedded
    .getByText("Inspect assembled context", { exact: true })
    .click();
  await embedded
    .getByRole("combobox", { name: "Model call", exact: true })
    .selectOption(reportContext!);
  await expect(
    embedded.getByRole("region", {
      name: "Retrieved passages in model context",
      exact: true,
    }),
  ).toContainText(contextVersion!);
  expect(
    await page.evaluate(() => document.body.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("harness-context-inspector.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  await page.getByRole("tab", { name: "Research trail", exact: true }).click();
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
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "RAG", exact: true }).click();
  await page.getByLabel("Upload source file").setInputFiles({
    name: "browser-test.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Security requirements: all source access must be scoped to the selected project. Synthetic test upload.",
    ),
  });
  await expect(
    page.getByRole("table").getByText("browser-test.txt", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
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
