import { test, expect, type Page } from "@playwright/test";

async function expectCheckboxLayout(page: Page, name: string) {
  const checkbox = page.getByRole("checkbox", { name, exact: true });
  const bounds = await checkbox.evaluate((input) => {
    const box = input.getBoundingClientRect();
    const label = input.closest("label")!;
    const text = label.querySelector("span")!.getBoundingClientRect();
    return {
      width: box.width,
      height: box.height,
      gap: text.left - box.right,
      topOffset: box.top - text.top,
      withinLabel: text.right <= label.getBoundingClientRect().right + 1,
    };
  });
  expect(bounds.width).toBe(16);
  expect(bounds.height).toBe(16);
  expect(bounds.gap).toBeGreaterThanOrEqual(8);
  expect(bounds.topOffset).toBeGreaterThanOrEqual(0);
  expect(bounds.topOffset).toBeLessThan(8);
  expect(bounds.withinLabel).toBeTruthy();
}

test("real judge contract validates without inference and scripted suites omit model grading controls", async ({
  page,
}, info) => {
  await page.goto("/");
  const harness = page.getByRole("region", {
    name: "Harness workspace",
    exact: true,
  });
  await harness
    .getByRole("combobox", { name: "Output contract", exact: true })
    .selectOption("judge");
  await harness
    .getByRole("button", { name: "Validate sample", exact: true })
    .click();
  await expect(harness.getByRole("status")).toContainText(
    "Output matches the contract.",
  );
  await harness
    .getByRole("textbox", { name: "Contract JSON", exact: true })
    .fill(
      JSON.stringify({ label: "absolute truth", reason: "Unsupported label" }),
    );
  await harness
    .getByRole("button", { name: "Validate sample", exact: true })
    .click();
  await expect(harness.getByRole("status")).toContainText(
    "Output does not match the contract.",
  );
  await page.getByRole("button", { name: "Evaluations", exact: true }).click();
  await page
    .getByLabel("Suite type", { exact: true })
    .selectOption("collection");
  await expect(
    page.getByRole("checkbox", {
      name: "Enable semantic judging",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", {
      name: "Semantic evaluation settings",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("region", { name: "Evaluation suite", exact: true })
    .screenshot({ path: info.outputPath("scripted-evaluation-options.png") });
});

test("provider-double UI: judge selection, configuration-bound consent and saved claim grades", async ({
  page,
}, info) => {
  let submitted: Record<string, any> | undefined;
  let gradeReads = 0;
  let judgePricingKnown = true;
  let defaultModel = "judge-b";
  const hash = "a".repeat(64);
  const grade = (index: number, label: string, ungraded = false) => ({
    id: `grade-${index}-${ungraded}`,
    run_id: `run-${index}`,
    claim_index: ungraded ? 1 : 0,
    status: ungraded ? "ungraded" : "graded",
    tokens_charged: ungraded ? 0 : 47,
    token_bound: 1800,
    request: {
      model_id: "judge-c",
      claim_preview: "The cited synthetic requirement is seven days.",
      evidence_ids: ["evidence-a"],
      source_version_ids: ["version-a"],
      input_sha256: hash,
      prompt_sha256: hash,
      schema_sha256: hash,
      context_policy: "cited-passages-only/redacted-v1",
    },
    result: ungraded
      ? {
          reason: "Judge token budget exhausted",
          estimated_cost_usd: 0,
          cost_source: "no call",
        }
      : {
          label,
          reason: "The cited passage states this synthetic requirement.",
          estimated_cost_usd: null,
          cost_source: "unavailable",
          usage: { input_tokens: 40, output_tokens: 7, total_tokens: 47 },
        },
  });
  const strategies = ["rag", "workflow", "agent"];
  const raw = strategies.map((strategy, i) => ({
    case: "custom-1",
    strategy,
    run_id: `run-${i}`,
    status: "completed",
    checks: {},
    ranked_sources: ["requirements.md"],
    latency_seconds: 1,
    question: "Which retention requirement is supported?",
    recall_at_k: 1,
    citation_validity: 1,
    quote_support: null,
    tokens: 100,
    judging: {
      model_id: "judge-c",
      claims: 3,
      sampled: 2,
      unsampled: 1,
      graded: 1,
      ungraded: 1,
      semantic_support: i ? 0 : 1,
      judgments: [
        grade(i, ["supported", "contradicted", "insufficient"][i]),
        grade(i, "", true),
      ],
    },
  }));
  const result = {
    id: "evaluation-a",
    mode: "live",
    created_at: "2026-10-23T18:00:00Z",
    versions: { judge_model: "judge-c" },
    raw,
    results: strategies.map((strategy) => ({
      strategy,
      cases: 1,
      recall_at_k: 1,
      mrr: 1,
      citation_validity: 1,
      quote_support: null,
      completion_rate: 1,
      mean_tokens: 100,
      mean_latency_seconds: 1,
      estimated_cost_usd: null,
    })),
  };
  const job = {
    id: "job-a",
    status: "completed",
    request: {
      split: "development",
      custom: { judge_snapshot: { model_id: "judge-c" } },
    },
    progress: { completed: 3, total: 3 },
    result_id: "evaluation-a",
    cancel_requested: false,
    error: null,
    created_at: result.created_at,
  };
  await page.route("**/api/backend/**", async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/embedding-usage"))
      return route.fulfill({
        json: {
          summary: {
            requests: 0,
            unreported_requests: 0,
            reported_tokens: null,
            input_token_bound: null,
            estimated_cost_usd: null,
          },
          requests: [],
        },
      });
    const path = new URL(route.request().url()).pathname.replace(
      "/api/backend/",
      "",
    );
    const reply = (json: unknown, status = 200) =>
      route.fulfill({ json, status });
    if (path === "bootstrap")
      return reply({
        projects: [{ id: "project-a", name: "Synthetic judge UI test" }],
        examples: ["Which retention requirement is supported?"],
        live_enabled: true,
        model_catalog_enabled: true,
        evaluations_enabled: true,
        auth_mode: "demo",
      });
    if (path === "projects/project-a")
      return reply({
        collections: [
          {
            id: "collection-a",
            name: "Synthetic requirements",
            embedding_config: "openai-small-v1",
            document_count: 1,
            setup_status: "ready",
          },
        ],
        runs: [],
      });
    if (path.endsWith("/harness/models"))
      return reply({
        configured: true,
        models: ["writer-a", "judge-b", "judge-c"],
        default_model: defaultModel,
        live_enabled: true,
        pricing_configured: false,
        judge_pricing_configured: judgePricingKnown,
      });
    if (path.endsWith("/harness/presets")) return reply([]);
    if (path.endsWith("/harness/studio"))
      return reply({
        schemas: { plan: {}, assess: {}, report: {}, judge: {} },
        prompts: {
          plan: "Plan",
          assess: "Assess",
          report: "Report",
          judge: "Judge rubric",
        },
        context_caps: {},
        context_policy: "context-v1",
      });
    if (path.endsWith("/ingestions")) return reply([]);
    if (path.endsWith("/sources"))
      return reply([
        {
          id: "source-a",
          name: "requirements.md",
          status: "ready",
          current_version_id: "version-a",
          chunk_count: 1,
          version_count: 1,
        },
      ]);
    if (path.endsWith("/judgments")) {
      gradeReads++;
      return reply(raw.flatMap((r) => r.judging.judgments));
    }
    if (
      path.endsWith("/evaluation-jobs") &&
      route.request().method() === "POST"
    ) {
      submitted = route.request().postDataJSON();
      return reply(job, 202);
    }
    if (path.endsWith("/evaluation-jobs")) return reply(submitted ? [job] : []);
    if (path.endsWith("/evaluations")) return reply(submitted ? [result] : []);
    return reply({ detail: "Unexpected synthetic test request" }, 404);
  });
  await page.goto("/");
  expect(submitted).toBeUndefined();
  await page.getByRole("button", { name: "Evaluations", exact: true }).click();
  await page
    .getByLabel("Suite type", { exact: true })
    .selectOption("collection");
  await page
    .getByLabel("Evaluation mode", { exact: true })
    .selectOption("live");
  await expect(
    page.getByRole("checkbox", {
      name: "Enable semantic judging",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      "Model grading is optional. Select an evaluation judge in Harness to enable it.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Available model", exact: true })
    .selectOption("writer-a");
  await page
    .getByRole("combobox", { name: "Evaluation judge model", exact: true })
    .selectOption("judge-b");
  await page.getByRole("button", { name: "Evaluations", exact: true }).click();
  await page
    .getByLabel("Test question", { exact: true })
    .fill("Which retention requirement is supported?");
  await page
    .getByLabel("Expected supporting source", { exact: true })
    .selectOption("requirements.md");
  await page
    .getByRole("checkbox", { name: "Enable semantic judging", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Run collection evaluation", exact: true })
    .click();
  expect(submitted).toBeUndefined();
  const consent = page.getByRole("checkbox", {
    name: "Authorize paid evaluation",
    exact: true,
  });
  await expectCheckboxLayout(page, "Enable semantic judging");
  await expectCheckboxLayout(page, "Authorize paid evaluation");
  await consent
    .locator("..")
    .getByText("I authorize paid calls", { exact: false })
    .click();
  await expect(consent).toBeChecked();
  await consent.uncheck();
  await consent.check();
  const tokens = page.getByRole("spinbutton", {
    name: "Judge token budget",
    exact: true,
  });
  const seconds = page.getByRole("spinbutton", {
    name: "Judge grading seconds",
    exact: true,
  });
  const cost = page.getByRole("spinbutton", {
    name: "Judge estimated cost cap · USD",
    exact: true,
  });
  await expect(tokens).toHaveValue("6000");
  await expect(seconds).toHaveValue("120");
  await expect(cost).toHaveValue("0.25");
  await tokens.fill("5500");
  await expect(consent).not.toBeChecked();
  await tokens.fill("6000");
  await expect(consent).not.toBeChecked(); // Restoring a value never revives consent.
  await consent.check();
  await seconds.fill("60");
  await expect(consent).not.toBeChecked();
  await consent.check();
  await cost.fill("0.1");
  await expect(consent).not.toBeChecked();
  await consent.check();
  await tokens.fill("0");
  await consent.check();
  await page
    .getByRole("button", { name: "Run collection evaluation", exact: true })
    .click();
  expect(submitted).toBeUndefined();
  expect(
    await tokens.evaluate(
      (input: HTMLInputElement) => input.validity.rangeUnderflow,
    ),
  ).toBe(true);
  await tokens.fill("5500");
  await consent.check();
  await page
    .getByLabel("Claims sampled per investigation", { exact: true })
    .selectOption("1");
  await expect(consent).not.toBeChecked();
  await page
    .getByLabel("Claims sampled per investigation", { exact: true })
    .selectOption("2");
  await consent.check();
  await expect(
    page.getByText(
      "Select a model in Harness and authorize the paid comparison runs.",
      { exact: true },
    ),
  ).toHaveCount(0);
  // Discovery metadata can change without changing the selected judge.
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  judgePricingKnown = false;
  await page
    .getByRole("button", { name: "Refresh models", exact: true })
    .click();
  await page.getByRole("button", { name: "Evaluations", exact: true }).click();
  await expect(cost).toHaveCount(0);
  await expect(consent).not.toBeChecked();
  await consent.check();
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  judgePricingKnown = true;
  await page
    .getByRole("button", { name: "Refresh models", exact: true })
    .click();
  await page.getByRole("button", { name: "Evaluations", exact: true }).click();
  await expect(cost).toHaveValue("0.1");
  await expect(consent).not.toBeChecked();
  await consent.check();
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Evaluation judge model", exact: true })
    .selectOption("judge-c");
  defaultModel = "judge-c";
  await page
    .getByRole("button", { name: "Refresh models", exact: true })
    .click();
  await page.getByRole("button", { name: "Evaluations", exact: true }).click();
  await expect(consent).not.toBeChecked();
  await consent.check();
  await page.screenshot({
    path: info.outputPath("semantic-judge-settings-provider-double.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Run collection evaluation", exact: true })
    .click();
  await expect(page.locator(".benchmark-job .completed")).toBeVisible();
  expect(submitted?.custom.judge).toEqual({
    model_id: "judge-c",
    max_claims_per_run: 2,
    tokens: 5500,
    wall_seconds: 60,
    estimated_cost_usd: 0.1,
  });
  expect(submitted?.custom.confirm_paid).toBe(true);
  await page.getByText("Inspect 3 case results", { exact: true }).click();
  const grading = page
    .getByRole("region", { name: "Model judgments", exact: true })
    .first();
  await expect(grading).toContainText("claims outside the sample: 1");
  await grading.getByText("Claim 1 · supported", { exact: true }).click();
  await expect(grading).toContainText("judge-c");
  await grading.getByText("Claim 2 · Ungraded", { exact: true }).click();
  await expect(grading).toContainText("Judge token budget exhausted");
  expect(gradeReads).toBe(0);
  await page
    .getByText("Inspect saved model judgments", { exact: true })
    .click();
  await expect.poll(() => gradeReads).toBeGreaterThan(0);
  await expect(
    page.getByText("3 saved grades across 6 claim records.", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("semantic-judge-results-provider-double.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
