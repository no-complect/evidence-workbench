const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { NextRequest } = require("next/server");

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
  };
  vm.runInNewContext(compiled, context);
  return { route: context.exports.GET, calls };
}

for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) {
  test(`container bind address does not reject browser Host ${host}`, async () => {
    const { route, calls } = handler();
    const request = new NextRequest("http://0.0.0.0:3000/api/backend/bootstrap", {
      headers: { host },
    });
    assert.equal(request.nextUrl.hostname, "0.0.0.0");
    const response = await route(request, {
      params: Promise.resolve({ path: ["bootstrap"] }),
    });
    assert.equal(response.status, 200);
    assert.equal(calls[0].url, "http://api:8000/api/bootstrap");
  });

  test(`same-origin submission works for browser Host ${host}`, async () => {
    const { route, calls } = handler();
    const request = new NextRequest("http://0.0.0.0:3000/api/backend/projects", {
      method: "POST",
      headers: { host, origin: `http://${host}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "Synthetic project" }),
    });
    const response = await route(request, {
      params: Promise.resolve({ path: ["projects"] }),
    });
    assert.equal(response.status, 200);
    assert.equal(calls[0].options.method, "POST");
    assert.deepEqual(JSON.parse(Buffer.from(calls[0].options.body).toString()), {
      name: "Synthetic project",
    });
  });
}

test("nonlocal or malformed Host cannot use the local demo", async () => {
  for (const host of [
    undefined, "0.0.0.0:3000", "192.168.1.20:3000", "example.com:3000",
    "localhost.example.com:3000", "localhost:3000@evil.example",
    "localhost:3000/", "localhost:3000,example.com", "[::1",
  ]) {
    const { route, calls } = handler();
    const request = new NextRequest("http://localhost:3000/api/backend/bootstrap", {
      headers: host ? { host, "x-forwarded-host": "localhost:3000" } : {},
    });
    const response = await route(request, {
      params: Promise.resolve({ path: ["bootstrap"] }),
    });
    assert.equal(response.status, 403, `Host: ${host}`);
    assert.equal(calls.length, 0);
  }
});

test("cross-origin or wrong-port submissions remain rejected", async () => {
  for (const origin of ["http://evil.example", "http://localhost:3001", "null"]) {
    const { route, calls } = handler();
    const request = new NextRequest("http://0.0.0.0:3000/api/backend/projects", {
      method: "POST",
      headers: { host: "localhost:3000", origin },
    });
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
    APP_ENV: "production", API_URL: "https://api.example.test",
    API_SHARED_SECRET: "synthetic-proxy-test-secret", NEXT_PUBLIC_AUTH_MODE: "supabase",
  });
  const request = new NextRequest("https://research.example.test/api/backend/projects", {
    method: "POST",
    headers: { host: "research.example.test", origin: "https://research.example.test" },
  });
  const response = await route(request, {
    params: Promise.resolve({ path: ["projects"] }),
  });
  assert.equal(response.status, 200);
  assert.equal(calls[0].url, "https://api.example.test/api/projects");
});
