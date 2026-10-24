import { test, expect, type Page } from "@playwright/test";

async function expectTooltipInsideViewport(page: Page) {
  const content = page.locator("[data-help-tooltip]");
  await expect(content).toBeVisible();
  await expect
    .poll(() =>
      content.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return (
          box.left >= 8 &&
          box.top >= 8 &&
          box.right <= innerWidth - 8 &&
          box.bottom <= innerHeight - 8
        );
      }),
    )
    .toBe(true);
  return content;
}

test("contextual help supports hover, keyboard description, Escape and no execution", async ({
  page,
}, info) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/backend/"))
      writes.push(request.url());
  });
  await page.goto("/");
  const help = page.getByRole("button", {
    name: "About Harness configuration",
    exact: true,
  });
  await help.scrollIntoViewIfNeeded();
  if (info.project.name === "desktop") {
    await help.hover();
    const popup = await expectTooltipInsideViewport(page);
    await expect(popup).toContainText(
      "Saved runs keep their pinned instructions",
    );
    await popup.hover();
    await expect(page.getByRole("tooltip")).toBeVisible();
    await page.mouse.move(1, 1);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  }
  await help.focus();
  await expect(help).toHaveAccessibleDescription(
    /These settings apply to future investigations/,
  );
  await expectTooltipInsideViewport(page);
  await page.screenshot({ path: info.outputPath("harness-help.png") });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(help).toBeFocused();
  const contractHelp = page.getByRole("button", {
    name: "About Contract preview",
    exact: true,
  });
  await contractHelp.scrollIntoViewIfNeeded();
  await contractHelp.focus();
  await expect(contractHelp).toHaveAccessibleDescription(
    /Schema validation makes no model calls/,
  );
  await expect(page.getByRole("tooltip")).toHaveCount(1);
  await page.keyboard.press("Escape");
  expect(writes).toEqual([]);
});

test("card help opens by tap inside the collection dialog and Escape preserves the walkthrough", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "RAG", exact: true }).click();
  await page
    .getByRole("button", { name: "Add Collection", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Create an evidence collection",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  const initialName = await dialog
    .getByLabel("Collection name", { exact: true })
    .inputValue();
  const help = dialog.getByRole("button", {
    name: "About Collection setup",
    exact: true,
  });
  if (info.project.name === "mobile") await help.tap();
  else await help.click();
  const popup = await expectTooltipInsideViewport(page);
  await expect(help).toHaveAccessibleDescription(
    /You do not need to generate a dataset first/,
  );
  expect(
    await popup.evaluate((el) =>
      el.closest("dialog")?.getAttribute("aria-label"),
    ),
  ).toBe("Create an evidence collection");
  expect(
    await popup.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return !!document
        .elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
        ?.closest("[data-help-tooltip]");
    }),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("collection-dialog-help.png"),
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByLabel("Collection name", { exact: true }),
  ).toHaveValue(initialName);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("evaluation metric help explains meaning and stays within a narrow viewport", async ({
  page,
}, info) => {
  await page.route("**/api/backend/projects/*/evaluations", (route) =>
    route.fulfill({
      json: [
        {
          id: "synthetic-tooltip-evaluation",
          mode: "demo",
          created_at: "2026-10-23T20:00:00Z",
          versions: {},
          raw: [],
          results: ["rag", "workflow", "agent"].map((strategy) => ({
            strategy,
            cases: 1,
            recall_at_k: 1,
            mrr: 1,
            citation_validity: 1,
            quote_support: 1,
            completion_rate: 1,
            mean_latency_seconds: 1,
          })),
        },
      ],
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Evaluations", exact: true }).click();
  const help = page.getByRole("button", { name: "About MRR", exact: true });
  // Focusing an offscreen metric must keep its explanation open after scrolling.
  await page.evaluate(() => scrollTo(0, 0));
  await help.focus();
  await expect(help).toHaveAccessibleDescription(/rank 2 scores 0.5/);
  const popup = await expectTooltipInsideViewport(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() => popup.evaluate((el) => getComputedStyle(el).animationName))
    .toBe("none");
  await page.screenshot({
    path: info.outputPath("evaluation-metric-help.png"),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Tab");
  await expect(help).not.toBeFocused();
});
