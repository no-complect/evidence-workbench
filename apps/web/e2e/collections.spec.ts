import { test, expect, type Page } from "@playwright/test";

test("new investigation → collection walkthrough → same draft → explicit research", async ({
  page,
}, info) => {
  let submissions = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/projects\/[^/]+\/runs$/.test(new URL(request.url()).pathname)
    )
      submissions++;
  });
  await page.goto("/");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const projectDialog = page.getByRole("dialog", {
    name: "New project",
    exact: true,
  });
  await projectDialog
    .getByRole("textbox", { name: "Name", exact: true })
    .fill(`Collection-first ${Date.now()}`);
  await projectDialog
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(projectDialog).not.toBeVisible();
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  const workspace = page.getByRole("region", {
    name: "Workflows workspace",
    exact: true,
  });
  const setup = workspace.getByRole("button", {
    name: "Set up collection",
    exact: true,
  });
  const question = workspace.getByRole("textbox", {
    name: "What would you like to investigate?",
    exact: true,
  });
  await expect(setup).toBeEnabled();
  await page.getByRole("button", { name: "RAG", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "RAG collection", exact: true }),
  ).toBeDisabled();
  await expect(
    page
      .getByRole("combobox", { name: "RAG collection", exact: true })
      .locator("option:checked"),
  ).toHaveText("No collections yet");
  await expect(
    page.getByRole("button", { name: "Add Collection", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  await expect(
    workspace.getByRole("combobox", { name: "Collection", exact: true }),
  ).toHaveCount(0);
  await question.fill("short");
  await setup.click();
  const dialog = page.getByRole("dialog", {
    name: "Create an evidence collection",
  });
  await expect(
    dialog.getByRole("textbox", {
      name: "Decision or research question",
      exact: true,
    }),
  ).toHaveValue("short");
  await dialog
    .getByRole("button", { name: "Close collection walkthrough", exact: true })
    .click();
  await expect(question).toHaveValue("short");
  await expect(setup).toBeEnabled();
  await workspace
    .getByRole("button", { name: "Security requirements", exact: true })
    .click();
  const preservedQuestion = await question.inputValue();
  await workspace
    .getByRole("button", { name: "Research settings", exact: true })
    .click();
  await workspace
    .getByRole("spinbutton", { name: "Tool calls", exact: true })
    .fill("32");
  await page.screenshot({
    path: info.outputPath("collection-prerequisite.png"),
    fullPage: true,
  });
  await setup.click();
  await expect(
    dialog.getByRole("textbox", {
      name: "Decision or research question",
      exact: true,
    }),
  ).toHaveValue(preservedQuestion);
  const name = `Investigation sources ${Date.now()}`;
  await dialog.getByLabel("Collection name", { exact: true }).fill(name);
  await dialog
    .getByRole("button", { name: "Choose sources", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Review sources", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Prepare collection", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", {
      name: "Your collection is ready to inspect.",
      exact: true,
    }),
  ).toBeVisible({ timeout: 30000 });
  expect(submissions).toBe(0);
  await dialog
    .getByRole("button", { name: "Finish setup", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Workflows", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(question).toHaveValue(preservedQuestion);
  await expect(
    workspace.getByRole("spinbutton", { name: "Tool calls", exact: true }),
  ).toHaveValue("32");
  const selected = workspace.getByRole("combobox", {
    name: "Collection",
    exact: true,
  });
  await expect(selected.locator("option:checked")).toHaveText(
    `${name} · 10 docs`,
  );
  const collectionId = await selected.inputValue();
  const start = workspace.getByRole("button", {
    name: "Start research",
    exact: true,
  });
  await expect(start).toBeEnabled();
  expect(submissions).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("collection-return-to-draft.png"),
    fullPage: true,
  });
  const posted = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      /\/projects\/[^/]+\/runs$/.test(new URL(request.url()).pathname),
  );
  await start.click();
  const body = (await posted).postDataJSON();
  expect(body.collection_id).toBe(collectionId);
  expect(body.question).toBe(preservedQuestion);
  expect(body.limits.tool_calls).toBe(32);
  await expect(
    page.getByRole("heading", {
      name: "A plan before we proceed",
      exact: true,
    }),
  ).toBeVisible({ timeout: 30000 });
  expect(submissions).toBe(1);
});

test("loading and failed collection metadata never masquerade as a new collection", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let fail = false;
  await page.route("**/api/backend/projects/*", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await gate;
    await route.fulfill({
      status: fail ? 503 : 200,
      json: fail
        ? { detail: "Synthetic collection metadata failure" }
        : { collections: [], runs: [] },
    });
  });
  await page.goto("/");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  const workspace = page.getByRole("region", {
    name: "Workflows workspace",
    exact: true,
  });
  await expect(
    workspace.getByText("Loading collections…", { exact: true }),
  ).toBeVisible();
  await expect(
    workspace.getByRole("button", { name: "Start research", exact: true }),
  ).toBeDisabled();
  await expect(
    workspace.getByRole("button", { name: "Set up collection", exact: true }),
  ).toHaveCount(0);
  release();
  await expect(
    workspace.getByRole("button", { name: "Set up collection", exact: true }),
  ).toBeEnabled();
  fail = true;
  await page.reload();
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  await expect(
    workspace.getByText("Collections could not load. Retry above.", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    workspace.getByRole("button", { name: "Start research", exact: true }),
  ).toBeDisabled();
  await expect(
    workspace.getByRole("button", { name: "Set up collection", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  fail = false;
  await page
    .getByRole("alert")
    .filter({ hasText: "Project could not load" })
    .getByRole("button", { name: "Retry", exact: true })
    .click();
  await expect(
    workspace.getByRole("button", { name: "Set up collection", exact: true }),
  ).toBeEnabled();
});

test("an existing empty or interrupted collection opens RAG without creating a duplicate", async ({
  page,
}) => {
  let state = "ready";
  let writes = 0;
  const cid = "7a733118-b5a3-4ac7-85a4-cf2ac0b9768b";
  await page.route("**/api/backend/projects/**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      writes++;
      return route.fallback();
    }
    const pathname = new URL(request.url()).pathname;
    if (/\/projects\/[^/]+$/.test(pathname))
      return route.fulfill({
        json: {
          collections: [
            {
              id: cid,
              name: "Unfinished sources",
              document_count: 0,
              embedding_config: "demo-v1",
              setup_status: state,
            },
          ],
          runs: [],
        },
      });
    if (pathname.endsWith(`/collections/${cid}/sources`))
      return route.fulfill({ json: [] });
    return route.fallback();
  });
  for (state of ["ready", "preparing", "failed"]) {
    await page.goto("/");
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Workflows", exact: true }).click();
    await page
      .getByRole("region", { name: "Workflows workspace", exact: true })
      .getByRole("button", { name: "Review collection setup", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "RAG", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("combobox", { name: "RAG collection", exact: true }),
    ).toHaveValue(cid);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  expect(writes).toBe(0);
});

async function openWizard(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "RAG", exact: true }).click();
  await page
    .getByRole("button", { name: "Add Collection", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Create an evidence collection",
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel("Collection name", { exact: true })
    .fill(`Browser collection ${Date.now()}`);
  await dialog
    .getByRole("button", { name: "Choose sources", exact: true })
    .click();
  return dialog;
}

test("guided starter preparation → real retrieval methods → pinned provenance", async ({
  page,
}, info) => {
  const dialog = await openWizard(page);
  await dialog.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    dialog.getByLabel("Collection name", { exact: true }),
  ).toHaveValue(/^Browser collection /);
  await dialog
    .getByRole("button", { name: "Choose sources", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Use the synthetic architecture pack"),
  ).toBeChecked();
  await page.screenshot({
    path: info.outputPath("collection-sources.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Review sources", exact: true })
    .click();
  await expect(
    dialog.getByRole("list").last().getByRole("listitem"),
  ).toHaveCount(10);
  await dialog
    .getByRole("button", { name: "Prepare collection", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", {
      name: "Your collection is ready to inspect.",
    }),
  ).toBeVisible({ timeout: 30000 });
  const methodControl = dialog.getByRole("combobox", {
    name: "Retrieval method",
    exact: true,
  });
  expect((await methodControl.boundingBox())?.width).toBeGreaterThan(170);
  for (const method of ["keyword", "vector", "hybrid"]) {
    await dialog
      .getByRole("combobox", { name: "Retrieval method", exact: true })
      .selectOption(method);
    await dialog
      .getByRole("button", { name: "Search collection", exact: true })
      .click();
    await expect(
      dialog.getByText(`${method} results for “security retention”`, {
        exact: true,
      }),
    ).toBeVisible();
    const inspector = dialog.getByRole("region", {
      name: "Retrieval passage inspector",
      exact: true,
    });
    await expect(inspector.getByRole("blockquote")).toBeVisible();
  }
  await dialog
    .getByRole("button", { name: "Inspect retrieval provenance", exact: true })
    .click();
  await expect(
    dialog.getByText("Content SHA-256", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("collection-retrieval.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await dialog
    .getByRole("button", { name: "Finish setup", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByLabel("RAG collection").locator("option:checked"),
  ).toContainText("10 docs");
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(11);
  await page.screenshot({
    path: info.outputPath("rag-collection.png"),
    fullPage: true,
  });
});

test("own-source walkthrough exposes per-file errors, retries and deduplicated versions", async ({
  page,
}, info) => {
  const dialog = await openWizard(page);
  await dialog.getByLabel("Bring my own documents").check();
  const valid = {
    name: "quasar-policy.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Quasar archival policy requires immutable source evidence.",
    ),
  };
  await dialog
    .getByLabel("Collection source files", { exact: true })
    .setInputFiles([
      valid,
      {
        name: "corrupt.txt",
        mimeType: "text/plain",
        buffer: Buffer.from([255, 254]),
      },
      {
        name: "unsupported.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("one,two"),
      },
    ]);
  await dialog
    .getByRole("button", { name: "Review sources", exact: true })
    .click();
  await expect(
    dialog.getByText("Choose Markdown, text, or a text-based PDF.", {
      exact: true,
    }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Prepare collection", exact: true })
    .click();
  const batch = dialog.getByRole("region", { name: "Upload results" });
  await expect(batch).toContainText("Ready · 1 passages, 0 vectors");
  await expect(batch).toContainText("Text files must be UTF-8");
  await expect(batch).toContainText("File needs correction");
  await batch
    .getByRole("button", { name: "Retry corrupt.txt", exact: true })
    .click();
  await expect(
    batch.getByRole("button", { name: "Retry corrupt.txt", exact: true }),
  ).toBeEnabled();
  await dialog
    .getByLabel("Add more collection files", { exact: true })
    .setInputFiles(valid);
  await expect(batch).toContainText("Ready · reused existing version");
  await dialog.getByLabel("Retrieval question", { exact: true }).fill("quasar");
  await dialog
    .getByRole("button", { name: "Search collection", exact: true })
    .click();
  const inspector = dialog.getByRole("region", {
    name: "Retrieval passage inspector",
    exact: true,
  });
  await expect(inspector).toContainText("Quasar archival policy");
  await expect(inspector).toContainText("Uploaded source");
  await page.screenshot({
    path: info.outputPath("own-source-results.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Finish setup", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page
      .getByRole("table")
      .getByRole("row")
      .filter({ hasText: "quasar-policy.txt" }),
  ).toContainText("ready");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
