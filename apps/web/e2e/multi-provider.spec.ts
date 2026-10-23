import { test, expect, type Page } from "@playwright/test";

test.use({ actionTimeout: 15000 });

async function providerWorkspace(page: Page, embeddings = true) {
  let failedOpenAI = false;
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  await page.route("**/api/backend/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/backend/",
      "",
    );
    const reply = (json: unknown, status = 200) =>
      route.fulfill({ json, status });
    if (route.request().method() !== "GET") {
      writes.push({ path, body: route.request().postDataJSON() });
      return reply(
        { detail: "Synthetic stop after provider request inspection" },
        409,
      );
    }
    if (path === "bootstrap")
      return reply({
        projects: [{ id: "project-a", name: "Provider contract fixture" }],
        examples: ["What security evidence is available?"],
        auth_mode: "demo",
        live_enabled: true,
        model_catalog_enabled: true,
        evaluations_enabled: true,
      });
    if (path === "projects/project-a")
      return reply({
        collections: [
          {
            id: "collection-a",
            name: "Live evidence",
            document_count: 1,
            embedding_config: "openai-small-v1",
            setup_status: "ready",
          },
        ],
        runs: [],
      });
    if (path.endsWith("/harness/models"))
      return reply({
        configured: true,
        models: [
          ...(embeddings && !failedOpenAI ? ["openai-research"] : []),
          "anthropic:account-research",
          "anthropic:account-judge",
        ],
        default_model: embeddings
          ? "openai-research"
          : "anthropic:account-research",
        live_enabled: true,
        embeddings_configured: embeddings,
        pricing_configured: false,
        judge_pricing_configured: false,
        providers: [
          ...(embeddings
            ? [
                {
                  provider: "openai",
                  count: failedOpenAI ? 0 : 1,
                  error: failedOpenAI
                    ? "Could not load OpenAI models. Check the server key and connectivity."
                    : null,
                },
              ]
            : []),
          { provider: "anthropic", count: 2, error: null },
        ],
      });
    if (path.endsWith("/harness/studio"))
      return reply({
        schemas: { plan: {}, assess: {}, report: {}, judge: {} },
        prompts: {
          plan: "Plan",
          assess: "Assess",
          report: "Report",
          judge: "Judge",
        },
        context_caps: {},
        context_policy: "context-v1",
      });
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
    if (
      path.endsWith("/harness/presets") ||
      path.endsWith("/evaluation-jobs") ||
      path.endsWith("/evaluations")
    )
      return reply([]);
    return reply({ detail: "Unexpected provider fixture request" }, 404);
  });
  await page.goto("/");
  const harness = page.getByRole("region", {
    name: "Harness workspace",
    exact: true,
  });
  await expect(
    harness.getByRole("combobox", { name: "Available model", exact: true }),
  ).toBeEnabled();
  return {
    harness,
    writes,
    failOpenAI: () => {
      failedOpenAI = true;
    },
  };
}

test("provider selections carry into research and partial discovery failures preserve the draft", async ({
  page,
}, info) => {
  const scenario = await providerWorkspace(page);
  const { harness, writes } = scenario;
  const model = harness.getByRole("combobox", {
    name: "Available model",
    exact: true,
  });
  await model.selectOption("anthropic:account-research");
  await harness
    .getByRole("combobox", { name: "Planner model", exact: true })
    .selectOption("openai-research");
  await harness
    .getByRole("combobox", { name: "Evaluation judge model", exact: true })
    .selectOption("anthropic:account-judge");
  expect(writes).toEqual([]);
  await harness
    .getByRole("combobox", { name: "Harness execution profile", exact: true })
    .selectOption("live");
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  await page
    .getByRole("button", { name: "Start research", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Synthetic stop");
  expect(writes).toHaveLength(1);
  expect(writes[0].body.model_id).toBe("anthropic:account-research");
  expect(writes[0].body.harness_config).toMatchObject({
    stage_models: { plan: "openai-research" },
  });
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  scenario.failOpenAI();
  await harness
    .getByRole("button", { name: "Refresh models", exact: true })
    .click();
  await expect(harness.getByRole("alert")).toContainText(
    "Could not load OpenAI models",
  );
  await expect(model).toHaveValue("anthropic:account-research");
  await expect(
    harness.getByRole("combobox", { name: "Planner model", exact: true }),
  ).toHaveValue("openai-research");
  await expect(
    harness.getByRole("option", {
      name: "openai-research · unavailable",
      exact: true,
    }),
  ).toHaveCount(1);
  expect(writes).toHaveLength(1);
  await page.screenshot({
    path: info.outputPath("multi-provider-partial-discovery.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("Anthropic-only discovery stays selectable while the live embedding requirement is explicit", async ({
  page,
}, info) => {
  const { harness, writes } = await providerWorkspace(page, false);
  await expect(harness).toContainText("Live RAG also requires OPENAI_API_KEY");
  await harness
    .getByRole("combobox", { name: "Available model", exact: true })
    .selectOption("anthropic:account-judge");
  await expect(
    harness
      .getByRole("combobox", { name: "Harness execution profile", exact: true })
      .locator('option[value="live"]'),
  ).toBeDisabled();
  await expect(
    harness.getByRole("combobox", {
      name: "Harness execution profile",
      exact: true,
    }),
  ).toHaveValue("demo");
  expect(writes).toEqual([]);
  await page.screenshot({
    path: info.outputPath("anthropic-embedding-boundary.png"),
    fullPage: true,
  });
});

test("independent Anthropic judge selection reaches the explicitly authorized evaluation request", async ({
  page,
}) => {
  const { harness, writes } = await providerWorkspace(page);
  await harness
    .getByRole("combobox", { name: "Evaluation judge model", exact: true })
    .selectOption("anthropic:account-judge");
  await page.getByRole("button", { name: "Evaluations", exact: true }).click();
  await page
    .getByLabel("Suite type", { exact: true })
    .selectOption("collection");
  await page
    .getByLabel("Evaluation mode", { exact: true })
    .selectOption("live");
  await page
    .getByLabel("Test question", { exact: true })
    .fill("Which security evidence supports the requirement?");
  await page
    .getByLabel("Expected supporting source", { exact: true })
    .selectOption("requirements.md");
  await page
    .getByRole("checkbox", { name: "Enable semantic judging", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Run collection evaluation", exact: true })
    .click();
  expect(writes).toEqual([]);
  await page
    .getByRole("checkbox", { name: "Authorize paid evaluation", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Run collection evaluation", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Synthetic stop");
  expect(writes).toHaveLength(1);
  expect(writes[0].body.custom).toMatchObject({
    model_id: "openai-research",
    confirm_paid: true,
    judge: { model_id: "anthropic:account-judge" },
  });
});
