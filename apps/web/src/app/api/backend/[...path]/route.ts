import { NextRequest } from "next/server";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const allowed = new Set(["bootstrap", "projects"]);
async function proxy(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  if (
    !allowed.has(path[0]) ||
    path.some((p) => !/^[a-zA-Z0-9_.-]+$/.test(p) || p === "..")
  )
    return Response.json({ detail: "Invalid route" }, { status: 404 });
  const local =
    process.env.APP_ENV === "local" || process.env.APP_ENV === "test";
  let expectedOrigin = request.nextUrl.origin;
  if (local) {
    // Next.js may construct nextUrl from the container's 0.0.0.0 bind address.
    // Validate the browser-facing Host instead; do not trust forwarded headers.
    const host = request.headers.get("host");
    let browserUrl: URL | undefined;
    if (host && !/[\s\\/@?#,]/.test(host)) {
      try {
        browserUrl = new URL(`${request.nextUrl.protocol}//${host}`);
      } catch {
        // Malformed authorities fail closed below.
      }
    }
    if (
      !browserUrl ||
      !["localhost", "127.0.0.1", "[::1]"].includes(browserUrl.hostname)
    ) {
      return Response.json(
        {
          detail:
            "Local demo requires a loopback hostname. Open http://localhost:3000 or http://127.0.0.1:3000.",
        },
        { status: 403 },
      );
    }
    expectedOrigin = browserUrl.origin;
  }
  const origin = request.headers.get("origin");
  if (request.method !== "GET" && origin && origin !== expectedOrigin)
    return Response.json({ detail: "Origin rejected" }, { status: 403 });
  const base = process.env.API_URL || (local ? "http://127.0.0.1:8000" : "");
  const secret =
    process.env.API_SHARED_SECRET ||
    (local ? "local-demo-only-not-for-production" : "");
  if (
    !base ||
    !secret ||
    (!local && process.env.NEXT_PUBLIC_AUTH_MODE === "demo")
  )
    return Response.json(
      { detail: "Backend environment is not configured securely" },
      { status: 503 },
    );
  if (!local && !base.startsWith("https://"))
    return Response.json(
      { detail: "Production API_URL must use HTTPS" },
      { status: 503 },
    );
  if (Number(request.headers.get("content-length") || 0) > 9 * 1024 * 1024)
    return Response.json(
      { detail: "File exceeds upload limit" },
      { status: 413 },
    );
  try {
    const headers = new Headers({ "X-Workbench-Key": secret });
    for (const name of ["authorization", "content-type"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    let body: ArrayBuffer | undefined;
    if (request.method !== "GET" && request.body) {
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 9 * 1024 * 1024) {
          await reader.cancel();
          return Response.json(
            { detail: "File exceeds upload limit" },
            { status: 413 },
          );
        }
        chunks.push(part.value);
      }
      const joined = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      body = joined.buffer;
    }
    const response = await fetch(
      `${base}/api/${path.join("/")}${request.nextUrl.search}`,
      {
        method: request.method,
        headers,
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(50000),
        redirect: "error",
      },
    );
    const outgoing = new Headers({ "Cache-Control": "no-store" });
    for (const name of ["content-type", "content-disposition"]) {
      const value = response.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    return new Response(response.body, {
      status: response.status,
      headers: outgoing,
    });
  } catch {
    return Response.json(
      {
        detail:
          "The research API is unavailable. Start the local services or check API_URL.",
      },
      { status: 503 },
    );
  }
}
export { proxy as GET, proxy as POST };
