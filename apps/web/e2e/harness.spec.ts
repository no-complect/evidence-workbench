import { test, expect, type Page } from "@playwright/test";
import type {
  HarnessState,
  Connection,
  Verification,
} from "../src/features/harness/contracts";
import {
  initialResearchDraft,
  parseLimits,
} from "../src/features/workbench/research-state";

const secret = "synthetic-ui-credential-only";
const stageKeys = ["plan", "assess", "report"] as const;

async function mockHarness(page: Page) {
  const state: HarnessState = {
    server_key_available: false,
    live_enabled: true,
    connections: [],
    checks: [],
    revisions: [],
  };
  const keys: string[] = [];
  let startBody: Record<string, unknown> | undefined;
  let failVerification = true;
  await page.route("**/api/backend/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/backend/",
      "",
    );
    const method = route.request().method();
    const reply = (json: unknown, status = 200) =>
      route.fulfill({ status, json });
    if (path === "bootstrap")
      return reply({
        projects: [
          { id: "project-a", name: "Local test project" },
          { id: "project-b", name: "Other project" },
        ],
        examples: [],
        live_enabled: true,
        evaluations_enabled: false,
        provider_connections_enabled: true,
        auth_mode: "demo",
      });
    if (path === "projects/project-a" || path === "projects/project-b")
      return reply({
        collections: [
          {
            id: "live-index",
            name: "Live index",
            embedding_config: "openai-small-v1",
            document_count: 0,
          },
        ],
        runs: [],
      });
    if (path.endsWith("/harness") && method === "GET")
      return reply(
        path.includes("project-b")
          ? { ...state, connections: [], checks: [], revisions: [] }
          : state,
      );
    if (path.endsWith("/harness/connections")) {
      const body = route.request().postDataJSON();
      expect(body.api_key).toBe(secret);
      const connection: Connection = {
        id: "connection-a",
        name: body.name,
        provider: "openai",
        active: true,
        catalog: [],
        discovered_at: null,
      };
      state.connections.push(connection);
      return reply(connection, 201);
    }
    if (path.endsWith("/discover")) {
      state.connections[0].catalog = [
        "account-model-a",
        "account-model-b",
        "embedding-model",
      ];
      state.connections[0].discovered_at = new Date().toISOString();
      return reply(state.connections[0].catalog);
    }
    if (path.endsWith("/verify")) {
      const body = route.request().postDataJSON();
      keys.push(body.idempotency_key);
      if (failVerification) {
        failVerification = false;
        return reply(
          { detail: "Synthetic uncertain response; retry the same request." },
          502,
        );
      }
      const check: Verification = {
        id: "check-a",
        connection_id: "connection-a",
        status: "verified",
        error: null,
        estimated_cost: 0.025,
        actual_cost: 0.001,
        request: body,
      };
      if (!state.checks.length) state.checks.push(check);
      return reply(check);
    }
    if (path.endsWith("/revisions")) {
      const body = route.request().postDataJSON();
      expect(body.targets).toEqual({
        plan: "check-a",
        assess: "check-a",
        report: "check-a",
      });
      const target = {
        model_id: "account-model-a",
        provider: "openai",
        connection_id: "connection-a",
        connection_name: "Account A",
        verification_id: "check-a",
        input_usd_per_million: 1,
        output_usd_per_million: 3,
      };
      const hashes = Object.fromEntries(
        stageKeys.map((stage) => [stage, "a".repeat(64)]),
      ) as Record<(typeof stageKeys)[number], string>;
      const revision = {
        id: "revision-a",
        name: body.name,
        created_at: new Date().toISOString(),
        snapshot: {
          targets: { plan: target, assess: target, report: target },
          limits: body.limits,
          fingerprints: {
            adapter: "openai-json-schema-v1",
            context_policy: "context-v1",
            output_token_cap: 2200,
            prompts: hashes,
            contracts: hashes,
            tool_policy: "scoped-retrieval-opt-in-web-v1",
          },
        },
      };
      state.revisions = [revision];
      return reply(revision, 201);
    }
    if (path.endsWith("/runs") && method === "POST") {
      startBody = route.request().postDataJSON();
      return reply({ detail: "Synthetic enqueue check complete" }, 409);
    }
    if (path.endsWith("/disconnect")) {
      state.connections[0].active = false;
      state.connections[0].catalog = [];
      return reply({ status: "disconnected" });
    }
    throw new Error(`Unexpected harness request ${method} ${path}`);
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  return { state, keys, getStart: () => startBody };
}

test("mocked account catalog → explicit contract check → immutable model targets → workflow selection", async ({
  page,
}, info) => {
  const scenario = await mockHarness(page);
  const form = page.getByRole("form", { name: "Connect OpenAI", exact: true });
  await form.getByLabel("Connection name", { exact: true }).fill("Account A");
  await form.getByLabel("OpenAI API key", { exact: true }).fill(secret);
  await form
    .getByRole("button", { name: "Connect OpenAI", exact: true })
    .click();
  await expect(form.getByLabel("OpenAI API key", { exact: true })).toHaveValue(
    "",
  );
  const card = page.getByRole("region", {
    name: "Provider Account A",
    exact: true,
  });
  await card
    .getByRole("button", { name: "Discover available models", exact: true })
    .click();
  await expect(card).toContainText("3 catalog models");
  expect(scenario.state.checks).toHaveLength(0);
  await card
    .getByRole("combobox", { name: "Available model", exact: true })
    .selectOption("account-model-a");
  await card.getByLabel("Input USD / million", { exact: true }).fill("1");
  await card.getByLabel("Output USD / million", { exact: true }).fill("3");
  await card
    .getByRole("button", { name: "Run paid capability check", exact: true })
    .click();
  await expect(card).toContainText("Synthetic uncertain response");
  await card
    .getByRole("button", { name: "Run paid capability check", exact: true })
    .click();
  await expect(card.getByText("verified", { exact: true })).toBeVisible();
  expect(scenario.keys).toHaveLength(2);
  expect(scenario.keys[0]).toBe(scenario.keys[1]);
  const revision = page.getByRole("form", {
    name: "Save harness revision",
    exact: true,
  });
  for (const label of ["Planner model", "Reviewer model", "Writer model"])
    await revision
      .getByRole("combobox", { name: label, exact: true })
      .selectOption("check-a");
  await revision
    .getByRole("button", { name: "Save harness revision", exact: true })
    .click();
  await expect(revision).toContainText("Saved immutable revision");
  const saved = page.getByRole("region", {
    name: "Saved harness revisions",
    exact: true,
  });
  await saved.getByText("Research baseline", { exact: false }).click();
  await expect(saved).toContainText("account-model-a");
  await page.screenshot({
    path: info.outputPath("harness-model-targets.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  await page
    .getByRole("button", { name: "Research settings", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Execution mode", exact: true })
    .selectOption("live");
  await page
    .getByRole("combobox", { name: "Harness revision", exact: true })
    .selectOption("revision-a");
  await expect(page.getByLabel("Token budget", { exact: true })).toHaveValue(
    "48000",
  );
  await expect(
    page.getByLabel("Token budget", { exact: true }),
  ).toHaveAttribute("readonly", "");
  await page
    .getByRole("button", { name: "Start research", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Synthetic enqueue check complete" }),
  ).toBeVisible();
  expect(scenario.getStart()?.harness_revision_id).toBe("revision-a");
  expect(scenario.getStart()?.limits).toEqual(
    parseLimits(initialResearchDraft.limits),
  );
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  await expect(form.getByLabel("OpenAI API key", { exact: true })).toHaveValue(
    "",
  );
  await card.getByRole("button", { name: "Disconnect", exact: true }).click();
  await card
    .getByRole("button", { name: "Confirm disconnect", exact: true })
    .click();
  await expect(card.getByText("Disconnected", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain(secret);
});

test("real local connection storage clears credentials and allows explicit disconnect without inference", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const project = page.getByRole("dialog", {
    name: "New project",
    exact: true,
  });
  await project
    .getByRole("textbox", { name: "Name", exact: true })
    .fill(`Credential UI ${Date.now()}`);
  await project
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(project).not.toBeVisible();
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  const form = page.getByRole("form", { name: "Connect OpenAI", exact: true });
  await form
    .getByLabel("Connection name", { exact: true })
    .fill("Local placeholder account");
  await form.getByLabel("OpenAI API key", { exact: true }).fill(secret);
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/harness/connections") &&
      r.request().method() === "POST",
  );
  await form
    .getByRole("button", { name: "Connect OpenAI", exact: true })
    .click();
  expect(await (await response).text()).not.toContain(secret);
  await expect(form.getByLabel("OpenAI API key", { exact: true })).toHaveValue(
    "",
  );
  const card = page.getByRole("region", {
    name: "Provider Local placeholder account",
    exact: true,
  });
  await expect(card).toContainText("Live calls are disabled");
  await expect(
    card.getByRole("button", {
      name: "Run paid capability check",
      exact: true,
    }),
  ).toBeDisabled();
  await page.screenshot({
    path: info.outputPath("local-harness.png"),
    fullPage: true,
  });
  await card.getByRole("button", { name: "Disconnect", exact: true }).click();
  await card
    .getByRole("button", { name: "Confirm disconnect", exact: true })
    .click();
  await expect(card.getByText("Disconnected", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  await expect(form.getByLabel("OpenAI API key", { exact: true })).toHaveValue(
    "",
  );
});
