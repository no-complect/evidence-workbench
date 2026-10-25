import { test, expect, type Page } from "@playwright/test";

const trace = {
  prompt_id: "report-v1",
  prompt_hash: "immutable-prompt-hash",
  policy_version: "context-v1/strict",
  input_tokens_estimate: 1500,
  output_token_reservation: 2200,
  token_estimator: "utf8-bytes-upper-bound-v1",
  selected: [
    { evidence_id: "passage-one", reason: "Relevant saved evidence" },
    { evidence_id: "other-run", reason: "Relevant saved evidence" },
  ],
  excluded: [
    {
      evidence_id: "excluded",
      reason: "Flagged adversarial fixture; excluded from model context",
    },
  ],
};
const report = {
  id: "context-report",
  stage: "report",
  call_key: "report/attempt-1",
  payload: {
    ...trace,
    assembled_input: {
      trusted_instructions:
        "Follow saved trust boundaries. Cite supporting evidence.",
      user_requirements: "Saved question for [REDACTED EMAIL].",
      durable_summary: {
        sufficient: false,
        limitations: ["Cost evidence unavailable"],
      },
      untrusted_sources: [
        {
          evidence_id: "passage-one",
          source: "redacted-source.md",
          passage:
            "Saved passage for [REDACTED EMAIL]. Keep the original retention controls.",
          section: "Retention",
          page: null,
          offsets: [12, 90],
        },
        {
          evidence_id: "other-run",
          source: "unavailable-source.md",
          passage:
            "Saved passage whose original source is unavailable in this run.",
          section: "Missing reference",
          page: null,
          offsets: [0, 30],
        },
      ],
    },
  },
};
const legacy = {
  id: "legacy",
  stage: "assess",
  call_key: "assess/legacy",
  payload: {
    ...trace,
    assembled_input: {
      redacted:
        "Context removed because safe redaction could not preserve the schema",
    },
  },
};
const plan = {
  id: "plan",
  stage: "plan",
  call_key: "plan/attempt-1",
  payload: {
    ...trace,
    selected: [],
    excluded: [],
    assembled_input: {
      trusted_instructions: "Plan the saved investigation.",
      user_requirements: "Saved planning question",
      untrusted_sources: [],
    },
  },
};
const malformed = {
  id: "partial",
  stage: "assess",
  call_key: "assess/partial",
  payload: {
    ...trace,
    assembled_input: {
      untrusted_sources: [null, { evidence_id: "bad-entry" }],
    },
  },
};

async function workspace(page: Page) {
  const calls: string[] = [];
  const run = {
    id: "saved-run",
    question: "Original run question must not reconstruct missing context",
    status: "completed",
    mode: "demo",
    strategy: "rag",
    plan: null,
    report: null,
    error: null,
    created_at: "2026-01-01T00:00:00Z",
    tokens_used: 1200,
    tools_used: 1,
    cost_used: 0,
    cancel_requested: false,
    request: {
      limits: {
        iterations: 1,
        tool_calls: 5,
        tokens: 4000,
        wall_seconds: 60,
        concurrency: 1,
        estimated_cost_usd: 1,
        top_k: 5,
      },
    },
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
    if (new URL(route.request().url()).pathname.endsWith("/ingestions"))
      return route.fulfill({ json: [] });
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/backend/", "");
    calls.push(`${request.method()} ${path}`);
    if (path === "bootstrap")
      return route.fulfill({
        json: {
          projects: [{ id: "project", name: "Context test" }],
          examples: [],
          live_enabled: false,
          evaluations_enabled: false,
          auth_mode: "demo",
        },
      });
    if (path === "projects/project")
      return route.fulfill({ json: { collections: [], runs: [run] } });
    if (path === "projects/project/runs/saved-run/events")
      return route.fulfill({ json: { events: [], cursor: 0 } });
    if (path === "projects/project/runs/saved-run")
      return route.fulfill({
        json: {
          run,
          tasks: [],
          contexts: [report, legacy, plan, malformed],
          evidence: [
            {
              id: "passage-one",
              chunk_id: "chunk",
              source_name: "original-source.md",
              text: "Original source has original-private@example.invalid.",
              version_id: "immutable-version-one",
              section: "Retention",
              page: null,
              start_offset: 12,
              end_offset: 90,
              scores: { rrf: 0.02, reranker: "disabled" },
              metadata: { synthetic: true },
            },
            {
              id: "excluded",
              chunk_id: "excluded-chunk",
              source_name: "excluded-original.md",
              text: "EXCLUDED_RAW_TEXT",
              version_id: "excluded-version",
              section: "Untrusted",
              page: null,
              start_offset: 0,
              end_offset: 20,
              scores: { rrf: 0.01, reranker: "disabled" },
              metadata: { synthetic: true, untrusted_instructions: true },
            },
          ],
        },
      });
    return route.fulfill({
      status: 404,
      json: { detail: "Unexpected request" },
    });
  });
  await page.goto("/");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page
    .getByRole("combobox", { name: "Saved investigation", exact: true })
    .selectOption("saved-run");
  await page.getByRole("tab", { name: "Context", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /^Context inspector/ }),
  ).toBeVisible();
  return calls;
}

test("saved context preserves redaction and opens only this run's original source", async ({
  page,
}, info) => {
  const calls = await workspace(page);
  const panel = page.getByRole("tabpanel", { name: "Context", exact: true });
  await expect(
    panel.getByRole("region", { name: "Trusted instructions", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("region", { name: "User requirements", exact: true }),
  ).toContainText("Saved question for [REDACTED EMAIL]");
  await expect(panel).not.toContainText("original-private@example.invalid");
  await expect(panel).not.toContainText("EXCLUDED_RAW_TEXT");
  await expect(panel).not.toContainText("Original run question");
  const sources = panel.getByRole("region", {
    name: "Retrieved passages in model context",
    exact: true,
  });
  await expect(sources).toContainText("Saved passage for [REDACTED EMAIL]");
  await expect(sources).toContainText("immutable-version-one");
  await sources
    .getByRole("button", { name: "Inspect source", exact: true })
    .first()
    .click();
  const drawer = page.getByRole("dialog", {
    name: "Evidence details",
    exact: true,
  });
  await expect(drawer).toContainText("original-private@example.invalid");
  await expect(drawer).toContainText("immutable-version-one");
  await page.keyboard.press("Escape");
  await expect(panel).not.toContainText("original-private@example.invalid");
  await sources.getByText("unavailable-source.md", { exact: false }).click();
  await expect(
    sources.getByRole("button", { name: "Inspect source", exact: true }).last(),
  ).toBeDisabled();
  await panel
    .getByText("Inspect selection and exclusion reasons", { exact: true })
    .click();
  await expect(panel).toContainText(
    "Flagged adversarial fixture; excluded from model context",
  );
  expect(
    calls.some(
      (call) =>
        call.includes("POST") ||
        call.includes("other-run/") ||
        call.includes("/evidence/"),
    ),
  ).toBe(false);
  expect(
    await page.evaluate(() => document.body.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("context-trust-boundaries.png"),
    fullPage: true,
  });
});

test("legacy and malformed inputs stay unavailable while call selection resets native details", async ({
  page,
}, info) => {
  await workspace(page);
  const panel = page.getByRole("tabpanel", { name: "Context", exact: true });
  const selection = panel.getByRole("combobox", {
    name: "Model call",
    exact: true,
  });
  await selection.selectOption("legacy");
  await expect(panel).toContainText("Structured context is unavailable");
  await expect(
    panel.getByRole("region", {
      name: "Retrieved passages in model context",
      exact: true,
    }),
  ).toHaveCount(0);
  const raw = panel
    .locator("details")
    .filter({
      has: page.getByText("Raw saved input and fingerprints", { exact: true }),
    })
    .last();
  await raw.locator("summary").first().click();
  await expect(raw).toContainText(
    "safe redaction could not preserve the schema",
  );
  await selection.selectOption("plan");
  await expect(panel).toContainText("No source passages were included");
  await expect(panel).toContainText("Saved planning question");
  await expect(
    panel
      .getByText("Raw saved input and fingerprints", { exact: true })
      .locator(".."),
  ).toHaveJSProperty("open", false);
  await selection.selectOption("partial");
  await expect(panel).toContainText("The saved source list could not be read");
  await expect(panel).not.toContainText("No source passages were included");
  await expect(panel).not.toContainText("original-private@example.invalid");
  expect(
    await page.evaluate(() => document.body.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("context-unavailable-record.png"),
    fullPage: true,
  });
});
