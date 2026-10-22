const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { QueryClient } = require("@tanstack/react-query");

function load(relative, dependencies = {}) {
  const source = fs.readFileSync(
    path.join(__dirname, "../src", relative),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const context = {
    exports: {},
    require: (name) => dependencies[name] ?? require(name),
  };
  vm.runInNewContext(compiled, context);
  return context.exports;
}
const ui = load("features/workbench/workspace-state.ts");
const research = load("features/workbench/research-state.ts");

test("changing the selected run closes stale evidence and updates navigation atomically", () => {
  const previous = {
    ...ui.initialWorkspaceState,
    overlay: { kind: "evidence", evidenceId: "private-evidence" },
    tab: "evidence",
  };
  const next = ui.workspaceReducer(previous, {
    type: "select-run",
    runId: "another-run",
  });
  assert.equal(next.overlay, null);
  assert.equal(next.runId, "another-run");
  assert.equal(next.tab, "report");
  assert.equal(previous.overlay.evidenceId, "private-evidence");
});

test("server-authoritative selection falls back when a stale ID is absent", () => {
  const current = [{ id: "available" }];
  assert.equal(ui.resolveSelection(current, "removed")?.id, "available");
  assert.equal(ui.resolveSelection([], "removed"), undefined);
});

test("workspace navigation preserves the selected run and workflow view while closing overlays", () => {
  const previous = {
    ...ui.initialWorkspaceState,
    runId: "saved",
    tab: "evidence",
    overlay: { kind: "evidence", evidenceId: "passage" },
  };
  const next = ui.workspaceReducer(previous, {
    type: "workspace",
    workspace: "rag",
  });
  assert.equal(next.workspace, "rag");
  assert.equal(next.runId, "saved");
  assert.equal(next.tab, "evidence");
  assert.equal(next.overlay, null);
  const selected = ui.workspaceReducer(next, {
    type: "select-run",
    runId: "another",
  });
  assert.equal(selected.workspace, "workflows");
  assert.equal(selected.tab, "report");
});

test("switching back to fixture mode clears previously enabled web access", () => {
  let draft = research.researchReducer(research.initialResearchDraft, {
    type: "mode",
    value: "live",
  });
  draft = research.researchReducer(draft, { type: "web", value: true });
  assert.equal(draft.webEnabled, true);
  draft = research.researchReducer(draft, { type: "mode", value: "demo" });
  assert.equal(draft.webEnabled, false);
  assert.equal(
    research.researchRequest(draft, "collection").web_enabled,
    false,
  );
});

test("numeric drafts allow editing but cannot submit empty, fractional or non-finite budgets", () => {
  for (const value of ["", "1.5", "Infinity", "-1"]) {
    const draft = research.researchReducer(research.initialResearchDraft, {
      type: "limit",
      key: "iterations",
      value,
    });
    assert.throws(() => research.researchRequest(draft, "collection"));
    assert.equal(research.initialResearchDraft.limits.iterations, "2");
  }
  const zeroCost = research.researchReducer(research.initialResearchDraft, {
    type: "limit",
    key: "estimated_cost_usd",
    value: "0",
  });
  assert.equal(
    research.researchRequest(zeroCost, "collection").limits.estimated_cost_usd,
    0,
  );
});

test("an uncertain submission reuses its idempotency key until the user's request changes", () => {
  let keys = 0;
  const createKey = () => `key-${++keys}`;
  const first = research.submissionIntent(
    null,
    { question: "same", collection: "one" },
    createKey,
  );
  const retry = research.submissionIntent(
    first,
    { question: "same", collection: "one" },
    createKey,
  );
  assert.equal(first.key, retry.key);
  const changed = research.submissionIntent(
    retry,
    { question: "changed", collection: "one" },
    createKey,
  );
  assert.notEqual(changed.key, first.key);
  assert.equal(keys, 2);
});

test("source requests consume cancellation and keep results in their project/collection scope", async () => {
  let signal;
  const queries = load("features/workbench/queries.ts", {
    "@/lib/workbench-api": {
      workbenchApi: {
        sources: (_project, collection, abort) => {
          if (collection === "old") {
            signal = abort;
            return new Promise((_resolve, reject) =>
              abort.addEventListener("abort", () =>
                reject(new Error("cancelled")),
              ),
            );
          }
          return Promise.resolve([{ id: "new", name: "Current source" }]);
        },
      },
    },
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  try {
    const oldOptions = queries.sourceOptions("project-a", "old");
    const old = client.fetchQuery(oldOptions);
    const rejection = assert.rejects(old);
    await client.cancelQueries({ queryKey: oldOptions.queryKey });
    await rejection;
    assert.equal(signal.aborted, true);
    const next = await client.fetchQuery(
      queries.sourceOptions("project-b", "new"),
    );
    assert.equal(next[0].name, "Current source");
    assert.equal(client.getQueryData(oldOptions.queryKey), undefined);
  } finally {
    client.clear();
  }
});

test("terminal runs still drain trailing event pages without losing or duplicating events", async () => {
  const cursors = [];
  let page = 0;
  const queries = load("features/workbench/queries.ts", {
    "@/lib/workbench-api": {
      workbenchApi: {
        run: async () => ({ run: { status: "completed" } }),
        events: async (_project, _run, cursor) => {
          cursors.push(cursor);
          if (page++ === 0)
            return {
              events: Array.from({ length: 200 }, (_, i) => ({ id: i + 1 })),
              cursor: 200,
            };
          return { events: [{ id: 200 }, { id: 201 }], cursor: 201 };
        },
      },
    },
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  try {
    const options = queries.runOptions(client, "project-a", "run-a");
    const first = await client.fetchQuery(options);
    assert.ok(options.refetchInterval({ state: { data: first } }) > 0);
    const last = await client.fetchQuery(options);
    assert.equal(last.events.length, 201);
    assert.deepEqual(cursors, [0, 200]);
    assert.equal(options.refetchInterval({ state: { data: last } }), false);
  } finally {
    client.clear();
  }
});
