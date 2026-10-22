import { test, expect, type Page, type Route } from "@playwright/test";

const projects = [
  { id: "project-a", name: "Project A" },
  { id: "project-b", name: "Project B" },
];
const collection = (id: string) => ({
  id,
  name: id,
  document_count: 1,
  embedding_config: "demo-v1",
});
const source = (name: string) => ({
  id: name,
  name,
  status: "ready",
  error: null,
  chunk_count: 1,
  version_count: 1,
});
const answer = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, json: body });

async function mockWorkspace(
  page: Page,
  handle?: (route: Route, path: string) => Promise<boolean>,
) {
  await page.route("**/api/backend/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/backend/",
      "",
    );
    if (await handle?.(route, path)) return;
    if (path === "bootstrap")
      return answer(route, {
        projects,
        examples: [],
        live_enabled: false,
        evaluations_enabled: true,
        auth_mode: "demo",
      });
    if (path === "projects/project-a")
      return answer(route, {
        collections: [collection("a-one"), collection("a-two")],
        runs: [],
      });
    if (path === "projects/project-b")
      return answer(route, { collections: [collection("b-one")], runs: [] });
    if (path.endsWith("/sources"))
      return answer(route, [source(`${path.split("/")[3]}.txt`)]);
    if (path.endsWith("/evaluations") || path.endsWith("/evaluation-jobs"))
      return answer(route, []);
    throw new Error(
      `Unexpected mocked request: ${route.request().method()} ${path}`,
    );
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Collection", exact: true }),
  ).toHaveValue("a-one");
}

test("switching collections ignores an old source response", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let began!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  let ended!: () => void;
  const finished = new Promise<void>((resolve) => {
    ended = resolve;
  });
  await mockWorkspace(page, async (route, path) => {
    if (path !== "projects/project-a/collections/a-one/sources") return false;
    began();
    await gate;
    try {
      await answer(route, [source("old-scope-private.txt")]);
    } catch (error) {
      if (!/closed|aborted|disposed/i.test(String(error))) throw error;
    } finally {
      ended();
    }
    return true;
  });
  await page.getByRole("button", { name: "RAG", exact: true }).click();
  await started;
  await page
    .getByRole("combobox", { name: "RAG collection", exact: true })
    .selectOption("a-two");
  await expect(page.getByText("a-two.txt", { exact: true })).toBeVisible();
  release();
  await finished;
  await expect(
    page.getByText("old-scope-private.txt", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("a-two.txt", { exact: true })).toBeVisible();
});

test("project changes reset drafts and dialog focus returns to its trigger", async ({
  page,
}) => {
  await mockWorkspace(page);
  const question = page.getByRole("textbox", {
    name: "What would you like to investigate?",
    exact: true,
  });
  const initialQuestion = await question.inputValue();
  await question.fill("Private draft for project A only");
  const menu = page.getByRole("button", {
    name: "Toggle navigation",
    exact: true,
  });
  if (await menu.isVisible()) await menu.click();
  const trigger = page.getByRole("button", {
    name: "New project",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "New project", exact: true });
  await expect(
    dialog.getByRole("textbox", { name: "Name", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  // Mobile navigation closes as the dialog opens, so its hidden trigger is not a focus target.
  if (!(await menu.isVisible())) await expect(trigger).toBeFocused();
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole("combobox", { name: "Project", exact: true })
    .selectOption("project-b");
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  await expect(question).toHaveValue(initialQuestion);
  await expect(
    page.getByRole("combobox", { name: "Collection", exact: true }),
  ).toHaveValue("b-one");
  await expect(
    page.getByRole("tab", { name: "Execution", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

test("research retries reuse an uncertain request key until the request changes", async ({
  page,
}) => {
  const keys: string[] = [];
  await mockWorkspace(page, async (route, path) => {
    if (
      path !== "projects/project-a/runs" ||
      route.request().method() !== "POST"
    )
      return false;
    keys.push(route.request().postDataJSON().idempotency_key);
    await answer(route, { detail: "Research response unavailable" }, 503);
    return true;
  });
  const start = page.getByRole("button", {
    name: "Start research",
    exact: true,
  });
  const error = page.getByText("Research response unavailable", {
    exact: true,
  });
  await start.click();
  await expect(error).toBeVisible();
  await start.click();
  await expect.poll(() => keys.length).toBe(2);
  await expect(error).toBeVisible();
  expect(keys[1]).toBe(keys[0]);
  await page
    .getByRole("textbox", {
      name: "What would you like to investigate?",
      exact: true,
    })
    .fill("A different question changes the submission intent");
  await start.click();
  await expect.poll(() => keys.length).toBe(3);
  expect(keys[2]).not.toBe(keys[0]);
});

test("successful evaluation polling does not erase a start error", async ({
  page,
}) => {
  let attempted = false;
  await mockWorkspace(page, async (route, path) => {
    if (path !== "projects/project-a/evaluation-jobs") return false;
    if (route.request().method() === "POST") {
      attempted = true;
      await answer(route, { detail: "Benchmark could not be queued" }, 503);
    } else
      await answer(
        route,
        attempted
          ? [
              {
                id: "older-job",
                status: "completed",
                request: { split: "development" },
                progress: { completed: 15, total: 15 },
                result_id: null,
                cancel_requested: false,
                error: null,
                created_at: "2026-01-01T00:00:00Z",
              },
            ]
          : [],
      );
    return true;
  });
  await page.getByRole("button", { name: "Evaluations", exact: true }).click();
  await page
    .getByRole("button", { name: "Run benchmark", exact: true })
    .click();
  const error = page.getByText("Benchmark could not be queued", {
    exact: true,
  });
  await expect(error).toBeVisible();
  await expect(page.locator(".benchmark-job")).toContainText("15 / 15 cases", {
    timeout: 15000,
  });
  await expect(error).toBeVisible();
});

test("notebook workspaces preserve drafts and fetch only the active resources", async ({
  page,
}, testInfo) => {
  const requested: string[] = [];
  await mockWorkspace(page, async (_route, path) => {
    requested.push(path);
    return false;
  });
  const question = page.getByRole("textbox", {
    name: "What would you like to investigate?",
    exact: true,
  });
  await question.fill("Preserve this investigation draft across workspaces");
  expect(
    requested.some(
      (path) => path.endsWith("/sources") || path.endsWith("/evaluation-jobs"),
    ),
  ).toBe(false);
  for (const workspace of ["Harness", "RAG", "Evaluations", "Workflows"]) {
    await page.getByRole("button", { name: workspace, exact: true }).click();
    await expect(
      page.getByRole("region", { name: `${workspace} workspace`, exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: testInfo.outputPath(`workspace-${workspace.toLowerCase()}.png`),
      fullPage: true,
    });
  }
  await expect(question).toHaveValue(
    "Preserve this investigation draft across workspaces",
  );
  expect(requested.some((path) => path.endsWith("/sources"))).toBe(true);
  expect(requested.some((path) => path.endsWith("/evaluation-jobs"))).toBe(
    true,
  );
});

test("evidence inspection deduplicates source references and exposes unavailable support", async ({
  page,
}) => {
  const run = {
    id: "saved-run",
    question: "Which controls apply to the deployment?",
    status: "completed",
    mode: "demo",
    strategy: "rag",
    plan: null,
    created_at: "2026-01-01T00:00:00Z",
    tokens_used: 1000,
    tools_used: 1,
    cost_used: 0,
    cancel_requested: false,
    error: null,
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
    report: {
      title: "Control review",
      summary: "Inspect the support.",
      partial: false,
      recommendations: [],
      limitations: ["A cost comparison is not established."],
      claims: [
        {
          text: "Retention controls require review.",
          evidence_ids: ["passage-a", "passage-a"],
          support: "direct_quote",
        },
        {
          text: "Unavailable supporting source",
          evidence_ids: ["unavailable"],
          support: "direct_quote",
        },
      ],
    },
  };
  await mockWorkspace(page, async (route, path) => {
    if (path === "projects/project-a") {
      await answer(route, { collections: [collection("a-one")], runs: [run] });
      return true;
    }
    if (path === "projects/project-a/runs/saved-run") {
      await answer(route, {
        run,
        contexts: [],
        tasks: [],
        evidence: [
          {
            id: "passage-a",
            chunk_id: "chunk-a",
            text: "Retention controls require review.",
            source_name: "security.md",
            version_id: "version-a",
            section: "Retention",
            page: null,
            start_offset: 0,
            end_offset: 34,
            scores: { rrf: 0.02, reranker: "disabled" },
            metadata: { synthetic: true },
          },
        ],
      });
      return true;
    }
    if (path === "projects/project-a/runs/saved-run/events") {
      await answer(route, { events: [], cursor: 0 });
      return true;
    }
    return false;
  });
  await page
    .getByRole("combobox", { name: "Saved investigation", exact: true })
    .selectOption("saved-run");
  await expect(
    page.locator(".run-strip .status-badge.completed"),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Evidence board", exact: true }).click();
  const inspector = page.getByRole("region", {
    name: "Selected evidence",
    exact: true,
  });
  await expect(inspector).toContainText("version-a");
  await expect(
    inspector.getByRole("button", { name: "Inspect provenance", exact: true }),
  ).toHaveCount(1);
  await expect(
    inspector.getByRole("button", { name: /Passage \d+/ }),
  ).toHaveCount(0);
  await page
    .getByRole("group", { name: "Research findings", exact: true })
    .getByRole("button", { name: /Unavailable supporting source/ })
    .click();
  await expect(inspector).toContainText("Supporting passage unavailable.");
  await expect(
    inspector.getByRole("button", { name: "Inspect provenance", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Filter evidence", exact: true })
    .fill("no-such-finding");
  await expect(
    page.getByRole("heading", { name: "No matching findings", exact: true }),
  ).toBeVisible();
  await expect(inspector).toHaveCount(0);
});
