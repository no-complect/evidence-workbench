import { test, expect } from "@playwright/test";

test("research cancellation removes approval and survives reopening the saved run", async ({
  page,
}) => {
  // Use real API persistence and the independent research worker; no routed doubles.
  const project = await page.request.post("/api/backend/projects", {
    data: { name: `Cancellation ${crypto.randomUUID()}` },
  });
  expect(project.status()).toBe(201);
  const pid = (await project.json()).id;
  const collection = await page.request.post(
    `/api/backend/projects/${pid}/collection-setups`,
    {
      data: {
        name: "Cancellation sources",
        purpose: "Verify cancellation at the approval boundary",
        source_kind: "starter",
        embedding_config: "demo-v1",
        idempotency_key: crypto.randomUUID(),
      },
    },
  );
  expect(collection.status()).toBe(201);

  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Project", exact: true })
    .selectOption(pid);
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  await page
    .getByRole("button", { name: "Start research", exact: true })
    .click();
  const approval = page.getByRole("heading", {
    name: "A plan before we proceed",
    exact: true,
  });
  await expect(approval).toBeVisible({ timeout: 30_000 });
  const savedRun = page.getByRole("combobox", {
    name: "Saved investigation",
    exact: true,
  });
  const rid = await savedRun.inputValue();
  expect(rid).not.toBe("");

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".run-strip .status-badge")).toHaveText(
    "cancelled",
  );
  await expect(approval).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Approve & investigate", exact: true }),
  ).toHaveCount(0);

  const response = await page.request.get(
    `/api/backend/projects/${pid}/runs/${rid}`,
  );
  expect(response.status()).toBe(200);
  const { run, evidence } = await response.json();
  expect(run.status).toBe("cancelled");
  expect(run.cancel_requested).toBe(true);
  expect(run.report).toBeNull();
  expect(evidence).toHaveLength(0);

  // A fresh page must read the terminal state from the backend, not a local draft.
  await page.reload();
  await page
    .getByRole("combobox", { name: "Project", exact: true })
    .selectOption(pid);
  await savedRun.selectOption(rid);
  await expect(page.locator(".run-strip .status-badge")).toHaveText(
    "cancelled",
  );
  await expect(approval).toHaveCount(0);
  await page
    .getByRole("button", { name: "New investigation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start research", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".run-strip")).toHaveCount(0);
});
