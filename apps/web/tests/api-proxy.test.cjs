const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { NextRequest } = require("next/server");
const envSource = fs.readFileSync(
  path.join(__dirname, "../src/lib/server-environment.ts"),
  "utf8",
);
const envContext = {
  exports: {},
  require: (name) => (name === "server-only" ? {} : require(name)),
  URL,
};
vm.runInNewContext(
  ts.transpileModule(envSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
  envContext,
);

const source = fs.readFileSync(
  path.join(__dirname, "../src/app/api/backend/[...path]/route.ts"),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

function handler(env = {}) {
  const calls = [];
  const context = {
    exports: {},
    process: { env: { APP_ENV: "local", API_URL: "http://api:8000", ...env } },
    Response,
    Headers,
    URL,
    AbortSignal,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return Response.json({ projects: [] });
    },
    require: (name) =>
      name === "@/lib/server-environment" ? envContext.exports : require(name),
  };
  vm.runInNewContext(compiled, context);
  return { route: context.exports.GET, calls };
}

for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) {
  test(`container bind address does not reject browser Host ${host}`, async () => {
    const { route, calls } = handler();
    const request = new NextRequest(
      "http://0.0.0.0:3000/api/backend/bootstrap",
      {
        headers: { host },
      },
    );
    assert.equal(request.nextUrl.hostname, "0.0.0.0");
    const response = await route(request, {
      params: Promise.resolve({ path: ["bootstrap"] }),
    });
    assert.equal(response.status, 200);
    assert.equal(calls[0].url, "http://api:8000/api/bootstrap");
  });

  test(`same-origin submission works for browser Host ${host}`, async () => {
    const { route, calls } = handler();
    const request = new NextRequest(
      "http://0.0.0.0:3000/api/backend/projects",
      {
        method: "POST",
        headers: {
          host,
          origin: `http://${host}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Synthetic project" }),
      },
    );
    const response = await route(request, {
      params: Promise.resolve({ path: ["projects"] }),
    });
    assert.equal(response.status, 200);
    assert.equal(calls[0].options.method, "POST");
    assert.deepEqual(
      JSON.parse(Buffer.from(calls[0].options.body).toString()),
      {
        name: "Synthetic project",
      },
    );
  });
}

test("nonlocal or malformed Host cannot use the local demo", async () => {
  for (const host of [
    undefined,
    "0.0.0.0:3000",
    "192.168.1.20:3000",
    "example.com:3000",
    "localhost.example.com:3000",
    "localhost:3000@evil.example",
    "localhost:3000/",
    "localhost:3000,example.com",
    "[::1",
  ]) {
    const { route, calls } = handler();
    const request = new NextRequest(
      "http://localhost:3000/api/backend/bootstrap",
      {
        headers: host ? { host, "x-forwarded-host": "localhost:3000" } : {},
      },
    );
    const response = await route(request, {
      params: Promise.resolve({ path: ["bootstrap"] }),
    });
    assert.equal(response.status, 403, `Host: ${host}`);
    assert.equal(calls.length, 0);
  }
});

test("cross-origin or wrong-port submissions remain rejected", async () => {
  for (const origin of [
    "http://evil.example",
    "http://localhost:3001",
    "null",
  ]) {
    const { route, calls } = handler();
    const request = new NextRequest(
      "http://0.0.0.0:3000/api/backend/projects",
      {
        method: "POST",
        headers: { host: "localhost:3000", origin },
      },
    );
    const response = await route(request, {
      params: Promise.resolve({ path: ["projects"] }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).detail, "Origin rejected");
    assert.equal(calls.length, 0);
  }
});

test("production keeps its configured HTTPS and browser origin checks", async () => {
  const { route, calls } = handler({
    APP_ENV: "production",
    API_URL: "https://api.example.test",
    API_SHARED_SECRET: "synthetic-proxy-test-secret-at-least-32-characters",
    NEXT_PUBLIC_AUTH_MODE: "supabase",
    NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.test",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-public-anon-key",
  });
  const request = new NextRequest(
    "https://research.example.test/api/backend/projects",
    {
      method: "POST",
      headers: {
        host: "research.example.test",
        origin: "https://research.example.test",
      },
    },
  );
  const response = await route(request, {
    params: Promise.resolve({ path: ["projects"] }),
  });
  assert.equal(response.status, 200);
  assert.equal(calls[0].url, "https://api.example.test/api/projects");
});

test("missing production settings are named without values, redirects or upstream calls", async () => {
  const { route, calls } = handler({
    APP_ENV: "production",
    API_URL: "",
    API_SHARED_SECRET: "synthetic-private-short-secret",
  });
  const response = await route(
    new NextRequest("https://web.example/api/backend/bootstrap"),
    { params: Promise.resolve({ path: ["bootstrap"] }) },
  );
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const result = await response.json();
  assert.equal(result.code, "configuration_error");
  for (const variable of [
    "API_URL",
    "API_SHARED_SECRET",
    "NEXT_PUBLIC_AUTH_MODE",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ])
    assert.ok(result.detail.includes(variable));
  assert.ok(!JSON.stringify(result).includes("synthetic-private-short-secret"));
  assert.equal(calls.length, 0);
});

test("invalid origins and missing APP_ENV cannot silently use local defaults", async () => {
  for (const env of [
    { APP_ENV: undefined },
    { API_URL: "https://user:synthetic-private@api.example" },
    { API_URL: "invalid-synthetic-private" },
  ]) {
    const { route, calls } = handler(env);
    const response = await route(
      new NextRequest("http://localhost:3000/api/backend/bootstrap", {
        headers: { host: "localhost:3000" },
      }),
      { params: Promise.resolve({ path: ["bootstrap"] }) },
    );
    assert.equal(response.status, 503);
    assert.ok(
      !JSON.stringify(await response.json()).includes("synthetic-private"),
    );
    assert.equal(calls.length, 0);
  }
});
