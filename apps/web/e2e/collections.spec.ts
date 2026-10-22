import { test, expect, type Page } from "@playwright/test";

async function openWizard(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "RAG", exact: true }).click();
  await page
    .getByRole("button", { name: "New collection", exact: true })
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
