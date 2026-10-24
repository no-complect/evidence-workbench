import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Detail } from "../src/lib/contracts";

const url = process.env.SUPABASE_URL!;
const anon = process.env.SUPABASE_ANON_KEY!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const origin = process.env.WORKBENCH_WEB_URL!;

function mask(value: string) {
  if (process.env.GITHUB_ACTIONS === "true")
    process.stdout.write(`::add-mask::${value}\n`);
}

test("two real identities: private sources, RLS, citations and same-browser sign-out", async ({
  page,
}) => {
  test.skip(process.env.WORKBENCH_SUPABASE_TEST !== "1");
  expect(new URL(url).hostname).toBe("127.0.0.1");
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    const callback = new URL(frame.url());
    const fragment = new URLSearchParams(callback.hash.slice(1));
    for (const name of ["access_token", "refresh_token"]) {
      const value = fragment.get(name);
      if (value) mask(value);
    }
  });
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, service, options);
  const emails = [0, 1].map(() => `workbench-${randomUUID()}@example.invalid`);
  const clients = emails.map(() => createClient(url, anon, options));
  const tokens: string[] = [];
  for (const [i, email] of emails.entries()) {
    const password = randomUUID() + "Aa9!";
    mask(password);
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(created.error === null).toBe(true);
    const signed = await clients[i].auth.signInWithPassword({
      email,
      password,
    });
    expect(signed.error === null).toBe(true);
    const token = signed.data.session!.access_token;
    mask(token);
    tokens.push(token);
  }

  async function login(index: number) {
    const link = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: emails[index],
      options: { redirectTo: origin },
    });
    expect(link.error === null).toBe(true);
    const action = link.data.properties!.action_link;
    mask(action);
    mask(new URL(action).searchParams.get("token") ?? "unused");
    try {
      await page.goto(action);
    } catch {
      throw new Error("Local sign-in navigation failed");
    }
    await expect(
      page.getByRole("button", { name: "Sign out", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Account")).toContainText(emails[index]);
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    // SDK consumes the callback; leave no token fragment in the address bar.
    await expect.poll(() => new URL(page.url()).hash === "").toBe(true);
  }

  async function api(
    path: string,
    token?: string,
    body?: unknown,
    method?: string,
  ) {
    return page.request.fetch(`${origin}/api/backend/${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        Origin: origin,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      data: body,
    });
  }

  async function newProject(name: string) {
    await page
      .getByRole("button", { name: "New project", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "New project",
      exact: true,
    });
    await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(name);
    await dialog
      .getByRole("button", { name: "Create project", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
  }

  await page.goto("/");
  await expect(
    page.getByLabel("Sign in to your research workspace"),
  ).toBeVisible();
  expect((await api("bootstrap")).status()).toBe(401);
  expect((await api("bootstrap", "invalid-session")).status()).toBe(401);
  await login(0);
  const browserScripts = await page
    .locator("script[src]")
    .evaluateAll((scripts) =>
      scripts.map((script) => (script as HTMLScriptElement).src),
    );
  for (const asset of browserScripts) {
    const source = await (await page.request.get(asset)).text();
    expect(source.includes(service)).toBe(false);
    expect(source.includes(process.env.API_SHARED_SECRET!)).toBe(false);
  }
  const projectA = `Private A ${randomUUID()}`;
  await newProject(projectA);
  const bootstrapA = await (await api("bootstrap", tokens[0])).json();
  const pid = bootstrapA.projects.find(
    (p: { name: string }) => p.name === projectA,
  ).id;
  const base = `projects/${pid}`;
  const setup = await api(`${base}/collection-setups`, tokens[0], {
    name: "Private security sources",
    purpose: "Verify actual auth and private source storage",
    source_kind: "starter",
    embedding_config: "demo-v1",
    idempotency_key: randomUUID(),
  });
  expect(setup.status()).toBe(201);
  const collection = await setup.json();
  expect(collection.document_count).toBe(10);
  const run = await api(`${base}/runs`, tokens[0], {
    collection_id: collection.id,
    question: bootstrapA.examples[1],
    mode: "demo",
    approve_plan: false,
    idempotency_key: randomUUID(),
  });
  expect(run.status()).toBe(202);
  const rid = (await run.json()).id;
  let detail: Detail | undefined;
  await expect
    .poll(
      async () => {
        const response = await api(`${base}/runs/${rid}`, tokens[0]);
        expect(response.status()).toBe(200);
        detail = await response.json();
        return detail!.run.status;
      },
      { timeout: 60_000 },
    )
    .toBe("completed");
  expect(detail!.run.report!.claims.length).toBeGreaterThan(0);
  const eid = detail!.run.report!.claims[0].evidence_ids[0];
  const evidence = await (
    await api(`${base}/evidence/${eid}`, tokens[0])
  ).json();
  const version = evidence.version_id;
  const ownedDownload = await api(
    `${base}/versions/${version}/download`,
    tokens[0],
  );
  expect(ownedDownload.status()).toBe(200);
  expect((await ownedDownload.body()).length).toBeGreaterThan(0);

  // Read through PostgREST with end-user JWTs, independently of API membership checks.
  await expect
    .poll(async () => {
      const response = await clients[0]
        .from("projects")
        .select("id")
        .eq("id", pid);
      return response.data?.length;
    })
    .toBe(1);
  const ownerSources = await clients[0]
    .from("source_versions")
    .select("id,storage_key")
    .eq("id", version);
  expect(ownerSources.error === null).toBe(true);
  expect(ownerSources.data?.length).toBe(1);
  const storageKey = ownerSources.data![0].storage_key;
  const bucket = await admin.storage.getBucket("research-sources");
  expect(bucket.data?.public).toBe(false);
  const stored = await admin.storage
    .from("research-sources")
    .download(storageKey);
  expect(stored.error === null).toBe(true);
  expect(
    Buffer.from(await stored.data!.arrayBuffer()).equals(
      await ownedDownload.body(),
    ),
  ).toBe(true);

  for (const table of [
    "projects",
    "collections",
    "source_documents",
    "source_versions",
    "chunks",
    "research_runs",
    "research_tasks",
    "evidence",
    "claims",
    "citations",
    "run_events",
    "usage_records",
  ]) {
    const column = table === "projects" ? "id" : "project_id";
    const denied = await clients[1].from(table).select("*").eq(column, pid);
    expect(denied.error === null).toBe(true);
    expect(denied.data?.length).toBe(0);
  }
  for (const table of [
    "effects",
    "contexts",
    "evaluation_jobs",
    "evaluation_judgments",
    "harness_presets",
  ]) {
    const result = await clients[0].from(table).select("*");
    expect(result.error !== null || result.data?.length === 0).toBe(true);
  }
  const write = await clients[0]
    .from("projects")
    .insert({ id: randomUUID(), name: "Direct write rejected" });
  expect(write.error !== null).toBe(true);
  const anonymous = createClient(url, anon, options);
  const anonymousRows = await anonymous
    .from("projects")
    .select("id")
    .eq("id", pid);
  expect(anonymousRows.error !== null || anonymousRows.data?.length === 0).toBe(
    true,
  );
  for (const client of [anonymous, clients[0], clients[1]]) {
    expect(
      (await client.storage.from("research-sources").download(storageKey))
        .error !== null,
    ).toBe(true);
    expect(
      (
        await client.storage
          .from("research-sources")
          .upload(`${pid}/${randomUUID()}`, "Rejected")
      ).error !== null,
    ).toBe(true);
  }
  const publicObject = await page.request.get(
    `${url}/storage/v1/object/public/research-sources/${storageKey}`,
  );
  expect(publicObject.ok()).toBe(false);

  const privatePaths = [
    base,
    `${base}/collections/${collection.id}/sources`,
    `${base}/runs/${rid}`,
    `${base}/runs/${rid}/events`,
    `${base}/runs/${rid}/report.md`,
    `${base}/evidence/${eid}`,
    `${base}/versions/${version}/download`,
    `${base}/evaluations`,
  ];
  for (const path of privatePaths) {
    expect((await api(path, tokens[1])).status()).toBe(404);
    expect((await api(path)).status()).toBe(401);
  }
  expect(
    (await api(`${base}/runs/${rid}/cancel`, tokens[1], {})).status(),
  ).toBe(404);
  const deniedUpload = await page.request.post(
    `${origin}/api/backend/${base}/collections/${collection.id}/sources`,
    {
      headers: { Authorization: `Bearer ${tokens[1]}`, Origin: origin },
      multipart: {
        file: {
          name: "rejected.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("Rejected"),
        },
      },
    },
  );
  expect(deniedUpload.status()).toBe(404);

  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Project", exact: true }),
  ).toHaveValue(pid);
  await page
    .getByRole("button", { name: "New investigation", exact: true })
    .click();
  const question = page.getByRole("textbox", {
    name: "What would you like to investigate?",
    exact: true,
  });
  await question.fill(
    "Private A draft must disappear when the account changes.",
  );
  await page.getByRole("button", { name: "RAG", exact: true }).click();
  await expect(page.getByText("04-security.md", { exact: true })).toBeVisible();
  const accountBox = await page.getByLabel("Account").boundingBox();
  expect(accountBox!.x + accountBox!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width + 1,
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByLabel("Sign in to your research workspace"),
  ).toBeVisible();
  await expect(page.getByText("04-security.md", { exact: true })).toHaveCount(
    0,
  );
  await login(1);
  const selector = page.getByRole("combobox", { name: "Project", exact: true });
  await expect(selector.locator("option", { hasText: projectA })).toHaveCount(
    0,
  );
  const projectB = `Private B ${randomUUID()}`;
  await newProject(projectB);
  await expect(selector.locator("option:checked")).toHaveText(projectB);
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  await expect(question).toHaveValue(bootstrapA.examples[0]);
  expect(
    (await (await api("bootstrap", tokens[1])).json()).projects.map(
      (p: { name: string }) => p.name,
    ),
  ).toEqual([projectB]);
  expect((await api(base, tokens[1])).status()).toBe(404);
  const bootstrapB = await (await api("bootstrap", tokens[1])).json();
  const bid = bootstrapB.projects[0].id;
  for (const path of [
    `projects/${bid}/runs/${rid}`,
    `projects/${bid}/evidence/${eid}`,
    `projects/${bid}/versions/${version}/download`,
    `projects/${bid}/collections/${collection.id}/sources`,
  ]) {
    expect((await api(path, tokens[1])).status()).toBe(404);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
