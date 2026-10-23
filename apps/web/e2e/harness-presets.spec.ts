import { test, expect } from "@playwright/test";

test("real presets persist, compare, apply and leave completed runs pinned", async ({
  page,
}, info) => {
  const created = await page.request.post("/api/backend/projects", {
    data: { name: `Harness presets ${Date.now()}` },
  });
  const pid = (await created.json()).id;
  const base = `/api/backend/projects/${pid}`;
  const collection = await page.request.post(`${base}/collection-setups`, {
    data: {
      name: "Preset evidence",
      purpose: "Verify security evidence",
      source_kind: "starter",
      embedding_config: "demo-v1",
      idempotency_key: crypto.randomUUID(),
    },
  });
  expect(collection.status()).toBe(201);
  await page.goto("/");
  await page.getByLabel("Project", { exact: true }).selectOption(pid);
  const presets = page.getByRole("region", {
    name: "Saved harness presets",
    exact: true,
  });
  const instruction = page.getByRole("textbox", {
    name: "System instruction",
    exact: true,
  });
  await instruction.fill("Preserve source gaps. Cite every supported finding.");
  await page
    .getByLabel("Context policy", { exact: true })
    .selectOption("strict");
  await page
    .getByLabel("Maximum research iterations", { exact: true })
    .selectOption("3");
  await presets
    .getByLabel("Preset name", { exact: true })
    .fill("Evidence baseline");
  await presets
    .getByRole("button", { name: "Save current draft", exact: true })
    .click();
  await expect(presets.getByRole("status")).toContainText("Preset saved");
  const firstId = await presets
    .getByLabel("Saved preset", { exact: true })
    .inputValue();
  await instruction.fill(
    "Highlight conflicting evidence and disclose uncertainty.",
  );
  await page
    .getByLabel("Context policy", { exact: true })
    .selectOption("balanced");
  await page
    .getByLabel("Maximum research iterations", { exact: true })
    .selectOption("1");
  await expect(presets).toContainText("3 of 14 settings differ");
  await presets
    .getByLabel("Preset name", { exact: true })
    .fill("Review alternative");
  await presets
    .getByRole("button", { name: "Save current draft", exact: true })
    .click();
  await expect(presets.getByRole("status")).toContainText("Preset saved");
  const secondId = await presets
    .getByLabel("Saved preset", { exact: true })
    .inputValue();
  expect(firstId).not.toBe(secondId);
  await page.reload();
  await page.getByLabel("Project", { exact: true }).selectOption(pid);
  await presets
    .getByLabel("Saved preset", { exact: true })
    .selectOption(firstId);
  await presets
    .getByLabel("Compare baseline with", { exact: true })
    .selectOption(secondId);
  await expect(presets).toContainText("3 of 14 settings differ");
  const table = presets.getByRole("table");
  await expect(
    table.getByRole("row", { name: /Context policy/ }),
  ).toContainText("strict");
  await expect(
    table.getByRole("row", { name: /Context policy/ }),
  ).toContainText("balanced");
  for (const width of [360, 768, 900, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize(
    info.project.name === "mobile"
      ? { width: 390, height: 844 }
      : { width: 1280, height: 900 },
  );
  await presets.screenshot({
    path: info.outputPath("harness-preset-comparison.png"),
  });
  await presets
    .getByRole("button", { name: "Apply to draft", exact: true })
    .click();
  await expect(instruction).toHaveValue(
    "Preserve source gaps. Cite every supported finding.",
  );
  await expect(
    page.getByLabel("Harness execution profile", { exact: true }),
  ).toHaveValue("demo");
  await page
    .getByRole("button", {
      name: "Investigate with this configuration",
      exact: false,
    })
    .click();
  const response = page.waitForResponse(
    (res) =>
      res.url().endsWith(`${base}/runs`) && res.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Start research", exact: true })
    .click();
  const runId = (await (await response).json()).id;
  await expect(
    page.getByRole("heading", {
      name: "A plan before we proceed",
      exact: true,
    }),
  ).toBeVisible({ timeout: 30000 });
  await page
    .getByRole("button", { name: "Approve & investigate", exact: true })
    .click();
  await expect(page.locator(".run-strip .status-badge.completed")).toBeVisible({
    timeout: 60000,
  });
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  await presets
    .getByLabel("Saved preset", { exact: true })
    .selectOption(secondId);
  await presets
    .getByRole("button", { name: "Apply to draft", exact: true })
    .click();
  await expect(instruction).toHaveValue(
    "Highlight conflicting evidence and disclose uncertainty.",
  );
  const detail = await (await page.request.get(`${base}/runs/${runId}`)).json();
  expect(detail.run.request.harness_config.context_policy).toBe("strict");
  expect(detail.run.request.limits.iterations).toBe(3);
  expect(detail.contexts.length).toBeGreaterThan(0);
  expect(
    detail.contexts.every((context: { payload: { policy_version: string } }) =>
      context.payload.policy_version.endsWith("/strict"),
    ),
  ).toBe(true);
  const saved = await (
    await page.request.get(`${base}/harness/presets`)
  ).json();
  expect(saved).toHaveLength(2);
  expect(
    saved.find((item: { id: string }) => item.id === firstId).settings
      .configuration.context_policy,
  ).toBe("strict");
});

test("uncertain save retries once, unavailable model IDs stay visible and project changes reset presets", async ({
  page,
}) => {
  const pid = (
    await (
      await page.request.post("/api/backend/projects", {
        data: { name: `Preset retry ${Date.now()}` },
      })
    ).json()
  ).id;
  const other = (
    await (
      await page.request.post("/api/backend/projects", {
        data: { name: `Other presets ${Date.now()}` },
      })
    ).json()
  ).id;
  const endpoint = `/api/backend/projects/${pid}/harness/presets`;
  const requests: { idempotency_key: string }[] = [];
  await page.route(`**${endpoint}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) {
      expect((await route.fetch()).status()).toBe(201);
      return route.abort("failed");
    }
    return route.continue();
  });
  await page.goto("/");
  await page.getByLabel("Project", { exact: true }).selectOption(pid);
  const presets = page.getByRole("region", {
    name: "Saved harness presets",
    exact: true,
  });
  await presets
    .getByLabel("Preset name", { exact: true })
    .fill("Recoverable save");
  await presets
    .getByRole("button", { name: "Save current draft", exact: true })
    .click();
  await expect(presets.getByRole("alert")).toBeVisible();
  // Workspace navigation must preserve an uncertain mutation error.
  await page.getByRole("button", { name: "RAG", exact: true }).click();
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  await expect(presets.getByRole("alert")).toBeVisible();
  await presets
    .getByRole("button", { name: "Save current draft", exact: true })
    .click();
  await expect(presets.getByRole("status")).toContainText("Preset saved");
  expect(requests).toHaveLength(2);
  expect(requests[0].idempotency_key).toBe(requests[1].idempotency_key);
  const saved = await (await page.request.get(endpoint)).json();
  expect(saved).toHaveLength(1);
  const unavailable = await page.request.post(endpoint, {
    data: {
      name: "Unavailable target",
      idempotency_key: crypto.randomUUID(),
      settings: {
        ...saved[0].settings,
        model_id: "retired-model",
        judge_model_id: "retired-judge",
        configuration: {
          ...saved[0].settings.configuration,
          stage_models: { plan: null, assess: null, report: "retired-writer" },
        },
      },
    },
  });
  const unavailableId = (await unavailable.json()).id;
  await page.reload();
  await page.getByLabel("Project", { exact: true }).selectOption(pid);
  await presets
    .getByLabel("Saved preset", { exact: true })
    .selectOption(unavailableId);
  await expect(presets).toContainText(
    "Not in the current model catalog: retired-model",
  );
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") writes.push(request.url());
  });
  await presets
    .getByRole("button", { name: "Apply to draft", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Available model", exact: true }),
  ).toHaveValue("retired-model");
  await expect(page.getByLabel("Writer model", { exact: true })).toHaveValue(
    "retired-writer",
  );
  await expect(
    page.getByLabel("Evaluation judge model", { exact: true }),
  ).toHaveValue("retired-judge");
  expect(writes).toEqual([]);
  await page.getByLabel("Project", { exact: true }).selectOption(other);
  await expect(presets.getByLabel("Preset name", { exact: true })).toHaveValue(
    "",
  );
  await expect(presets).toContainText("No presets yet");
  await expect(presets.getByLabel("Saved preset", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByLabel("Evaluation judge model", { exact: true }),
  ).toHaveValue("");
});
