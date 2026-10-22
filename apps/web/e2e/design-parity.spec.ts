import { test, expect } from "@playwright/test";

test("Harness studio → contract validation → real graph inspector → decision brief", async ({
  page,
}, info) => {
  await page.goto("/");
  const harness = page.getByRole("region", {
    name: "Harness workspace",
    exact: true,
  });
  await expect(
    harness.getByRole("region", { name: "Harness configuration", exact: true }),
  ).toBeVisible();
  await harness
    .getByLabel("System instruction", { exact: true })
    .fill("Preserve explicit evidence gaps. Cite the supplied passages.");
  await harness
    .getByLabel("Context policy", { exact: true })
    .selectOption("strict");
  await harness
    .getByRole("button", { name: "Validate sample", exact: true })
    .click();
  await expect(harness.getByRole("status")).toContainText(
    "Output matches the contract.",
  );
  await harness
    .getByRole("button", { name: "Try invalid output", exact: true })
    .click();
  await harness
    .getByRole("button", { name: "Validate sample", exact: true })
    .click();
  await expect(harness.getByRole("status")).toContainText(
    "Output does not match the contract.",
  );
  await page.screenshot({
    path: info.outputPath("harness-studio.png"),
    fullPage: true,
  });
  await harness
    .getByRole("button", {
      name: "Investigate with this configuration",
      exact: false,
    })
    .click();
  await page
    .getByRole("button", { name: "Start research", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "A plan before we proceed",
      exact: true,
    }),
  ).toBeVisible({ timeout: 30000 });
  await page
    .getByRole("button", { name: "Approve & investigate", exact: true })
    .click();
  await expect(page.locator(".run-strip .status-badge.completed")).toBeVisible({
    timeout: 60000,
  });
  await page.getByRole("tab", { name: "Execution", exact: true }).click();
  const graph = page.getByRole("region", {
    name: "Workflow graph",
    exact: true,
  });
  await graph.getByRole("button", { name: /Write the brief/ }).click();
  const inspector = page.getByRole("region", {
    name: "Node inspector",
    exact: true,
  });
  await expect(inspector).toContainText("Report completed");
  await expect(inspector).toContainText("report · assembled context");
  await inspector
    .getByText("report · assembled context", { exact: true })
    .click();
  await expect(inspector).toContainText("context-v1/strict");
  await expect(inspector).toContainText("Preserve explicit evidence gaps.");
  await page.screenshot({
    path: info.outputPath("execution-inspector.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Decision brief", exact: true }).click();
  await expect(
    page.getByRole("complementary", {
      name: "Unresolved findings",
      exact: true,
    }),
  ).toContainText("The constraints stay with the conclusion.");
  await expect(
    page.getByRole("button", { name: /Open citation/ }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("decision-brief.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("collection evaluation editor queues its own pinned comparison in the evaluation worker", async ({
  page,
}, info) => {
  const project = await page.request.post("/api/backend/projects", {
    data: { name: `Authored evaluation ${Date.now()}` },
  });
  expect(project.status()).toBe(200);
  const pid = (await project.json()).id;
  const collection = await page.request.post(
    `/api/backend/projects/${pid}/collection-setups`,
    {
      data: {
        name: "Evaluation sources",
        purpose: "Inspect security evidence",
        source_kind: "starter",
        embedding_config: "demo-v1",
        idempotency_key: crypto.randomUUID(),
      },
    },
  );
  expect(collection.status()).toBe(201);
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Project", exact: true })
    .selectOption(pid);
  await page.getByRole("button", { name: "Evaluations", exact: true }).click();
  await page
    .getByLabel("Suite type", { exact: true })
    .selectOption("collection");
  await page
    .getByLabel("Expected supporting source", { exact: true })
    .selectOption({ label: "04-security.md" });
  await page.screenshot({
    path: info.outputPath("evaluation-editor.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Run collection evaluation", exact: true })
    .click();
  await expect(
    page.locator(".benchmark-job .status-badge.completed"),
  ).toBeVisible({ timeout: 90000 });
  await expect(page.locator(".benchmark-job")).toContainText("3 / 3 cases");
  await page.getByText("Inspect 3 case results", { exact: true }).click();
  await expect(page.locator(".evaluation")).toContainText("custom-1");
  await expect(page.locator(".evaluation")).toContainText("source_version_ids");
  await page.screenshot({
    path: info.outputPath("evaluation-comparison.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
