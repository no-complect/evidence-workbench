import { test, expect, type Page } from "@playwright/test";
import type { ModelCatalog } from "../src/features/harness/contracts";

async function mockModels(page: Page, liveEnabled = true) {
  const models = [
    "gpt-4.1",
    "gpt-4.1-mini",
    ...Array.from({ length: 125 }, (_, i) => `other-family-${i}`),
  ];
  let fail = false;
  let submitted: Record<string, unknown> | undefined;
  let mutations = 0;
  await page.route("**/api/backend/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/backend/",
      "",
    );
    const method = route.request().method();
    const reply = (json: unknown, status = 200) =>
      route.fulfill({ status, json });
    if (method !== "GET") mutations++;
    if (path === "bootstrap")
      return reply({
        projects: [
          { id: "project-a", name: "First project" },
          { id: "project-b", name: "Second project" },
        ],
        examples: [],
        live_enabled: liveEnabled,
        model_catalog_enabled: true,
        evaluations_enabled: false,
        auth_mode: "demo",
      });
    if (path.endsWith("/harness/studio"))
      return reply({
        schemas: { plan: {}, assess: {}, report: {} },
        prompts: {
          plan: "Planner contract",
          assess: "Reviewer contract",
          report: "Report contract",
        },
        context_caps: { plan: 1800, assess: 5000, report: 6500 },
        context_policy: "context-v1",
      });
    if (path.endsWith("/harness/models")) {
      if (fail)
        return reply({ detail: "Model catalog temporarily unavailable" }, 502);
      const catalog: ModelCatalog = {
        configured: true,
        models,
        default_model: "gpt-4.1-mini",
        live_enabled: liveEnabled,
        pricing_configured: false,
      };
      return reply(catalog);
    }
    if (path === "projects/project-a" || path === "projects/project-b")
      return reply({
        collections: [
          {
            id: "live-index",
            name: "Live index",
            embedding_config: "openai-small-v1",
            document_count: 1,
            setup_status: "ready",
          },
        ],
        runs: [],
      });
    if (path.endsWith("/runs") && method === "POST") {
      submitted = route.request().postDataJSON();
      return reply({ detail: "Synthetic stop after request inspection" }, 409);
    }
    return reply({ detail: "Unexpected request" }, 404);
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  return {
    failRefresh: () => {
      fail = true;
    },
    submitted: () => submitted,
    mutations: () => mutations,
  };
}

test("environment catalog selection carries from Harness into a live workflow without setup or pricing forms", async ({
  page,
}, info) => {
  const scenario = await mockModels(page);
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  let workspace = page.getByRole("region", {
    name: "Harness workspace",
    exact: true,
  });
  const selector = workspace.getByRole("combobox", {
    name: "Available model",
    exact: true,
  });
  await expect(selector.locator("option")).toHaveCount(128);
  await selector.selectOption("other-family-124");
  await expect(page.getByLabel("OpenAI API key", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("Input USD / million", { exact: true }),
  ).toHaveCount(0);
  expect(scenario.mutations()).toBe(0);
  await page.screenshot({
    path: info.outputPath("environment-model-harness.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  workspace = page.getByRole("region", {
    name: "Workflows workspace",
    exact: true,
  });
  await workspace.getByRole("button", { name: "Research settings" }).click();
  await workspace.getByLabel("Execution mode").selectOption("live");
  await expect(
    workspace.getByRole("combobox", { name: "Available model", exact: true }),
  ).toHaveValue("other-family-124");
  await expect(
    workspace.getByText("Dollar estimates are unavailable", { exact: false }),
  ).toBeVisible();
  await workspace
    .getByRole("button", { name: "Start research", exact: true })
    .click();
  await expect(workspace.getByRole("alert")).toContainText("Synthetic stop");
  expect(scenario.submitted()?.model_id).toBe("other-family-124");
  expect(scenario.submitted()?.harness_revision_id).toBeNull();
  expect(scenario.mutations()).toBe(1);
  await page
    .getByRole("combobox", { name: "Project", exact: true })
    .selectOption("project-b");
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Harness workspace", exact: true })
      .getByRole("combobox", { name: "Available model", exact: true }),
  ).toHaveValue("gpt-4.1-mini");
});

test("model selection works with live inference off and survives a failed catalog refresh", async ({
  page,
}, info) => {
  const scenario = await mockModels(page, false);
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  const workspace = page.getByRole("region", {
    name: "Harness workspace",
    exact: true,
  });
  const selector = workspace.getByRole("combobox", {
    name: "Available model",
    exact: true,
  });
  await expect(selector).toBeEnabled();
  await selector.selectOption("other-family-124");
  scenario.failRefresh();
  await workspace
    .getByRole("button", { name: "Refresh models", exact: true })
    .click();
  await expect(workspace.getByRole("alert")).toContainText(
    "Model catalog temporarily unavailable",
  );
  await expect(selector).toHaveValue("other-family-124");
  await expect(selector.locator("option")).toHaveCount(128);
  expect(scenario.mutations()).toBe(0);
  await page.screenshot({
    path: info.outputPath("environment-model-refresh-error.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("real environment catalog returns a clear missing-key state without connection or probe forms", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  const workspace = page.getByRole("region", {
    name: "Harness workspace",
    exact: true,
  });
  await expect(
    workspace.getByText("Set OPENAI_API_KEY in the server environment", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    workspace.getByRole("combobox", { name: "Available model", exact: true }),
  ).toBeDisabled();
  await expect(
    workspace.getByRole("button", { name: "Connect OpenAI", exact: true }),
  ).toHaveCount(0);
  await expect(
    workspace.getByRole("button", {
      name: "Run paid capability check",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("environment-model-missing-key.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
