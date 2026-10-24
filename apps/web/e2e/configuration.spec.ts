import { test, expect } from "@playwright/test";

test("incomplete setup names the settings, makes no writes and recovers after configuration is fixed", async ({
  page,
}, info) => {
  let fixed = false;
  let requests = 0;
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/backend/"))
      writes++;
  });
  await page.route("**/api/backend/bootstrap", async (route) => {
    if (fixed) return route.continue();
    requests++;
    return route.fulfill({
      status: 503,
      json: {
        code: "configuration_error",
        detail:
          "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY before building the web app.",
      },
    });
  });
  await page.goto("/");
  const notice = page
    .getByRole("alert")
    .filter({ hasText: "Workspace setup is incomplete" });
  await expect(notice).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New project", exact: true }),
  ).not.toBeVisible();
  await expect(
    notice.getByRole("button", { name: "Retry", exact: true }),
  ).toHaveCount(0);
  await notice.getByText("Setup details", { exact: true }).click();
  await expect(notice).toContainText("NEXT_PUBLIC_SUPABASE_URL");
  await expect(notice).toContainText("rebuilding or redeploying");
  await page.waitForLoadState("networkidle");
  expect(requests).toBe(1);
  expect(writes).toBe(0);
  expect(
    await page.evaluate(() => document.body.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("setup-required.png"),
    fullPage: true,
  });
  fixed = true;
  await page.reload();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New project", exact: true }),
  ).toBeEnabled();
  await expect(notice).toHaveCount(0);
});

test("unavailable API offers Retry and recovers without losing the page", async ({
  page,
}, info) => {
  let offline = true;
  await page.route("**/api/backend/bootstrap", async (route) =>
    offline
      ? route.fulfill({
          status: 503,
          json: {
            detail:
              "The research API is unavailable. Start the local services or check API_URL.",
          },
        })
      : route.continue(),
  );
  await page.goto("/");
  const notice = page
    .getByRole("alert")
    .filter({ hasText: "Connection unavailable" });
  await expect(notice).toBeVisible();
  await expect(
    notice.getByRole("button", { name: "Retry", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "New project", exact: true }),
  ).not.toBeVisible();
  expect(
    await page.evaluate(() => document.body.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("service-unavailable.png"),
    fullPage: true,
  });
  offline = false;
  await notice.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(notice).toHaveCount(0);
});

test("optional AI setup keeps demo available with visible model guidance", async ({
  page,
}, info) => {
  await page.route("**/api/backend/bootstrap", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: {
        ...body,
        live_enabled: false,
        configuration: {
          web_search_enabled: false,
          notices: [
            "Live research is unavailable. Set OPENAI_API_KEY in the server environment for RAG embeddings, then restart the API and both workers. Demo remains available.",
          ],
        },
      },
    });
  });
  await page.goto("/");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  const workspace = page.getByRole("region", {
    name: "Harness workspace",
    exact: true,
  });
  const notice = page
    .getByRole("status")
    .filter({ hasText: "Some AI features are unavailable" });
  await expect(notice).toBeVisible();
  await notice.getByText("Setup details", { exact: true }).click();
  await expect(notice).toContainText("Demo remains available");
  await expect(
    workspace.getByRole("combobox", { name: "Available model", exact: true }),
  ).toBeDisabled();
  await expect(
    workspace
      .getByRole("combobox", { name: "Harness execution profile", exact: true })
      .locator("option[value=live]"),
  ).toBeDisabled();
  await expect(workspace).toContainText(
    "Set OPENAI_API_KEY or ANTHROPIC_API_KEY",
  );
  expect(
    await page.evaluate(() => document.body.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("optional-ai-setup.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Workflows workspace", exact: true }),
  ).toBeVisible();
});
