import { supabase } from "./supabase";
export type * from "./contracts";

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const client = supabase();
  if (client) {
    const { data } = await client.auth.getSession();
    if (data.session)
      headers.set("Authorization", `Bearer ${data.session.access_token}`);
  }
  const response = await fetch(`/api/backend/${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    const message = errorMessage(error, response.status);
    const keyMismatch =
      response.status === 401 && message === "Backend authentication required";
    const missingBrowserAuth =
      response.status === 401 &&
      message === "Sign in to continue" &&
      process.env.NEXT_PUBLIC_AUTH_MODE !== "supabase";
    throw new ApiError(
      response.status,
      keyMismatch
        ? "Set API_SHARED_SECRET to the same value on the web server and Python API, then restart or redeploy those services."
        : missingBrowserAuth
          ? "The API requires sign-in. Set NEXT_PUBLIC_AUTH_MODE=supabase, NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY before rebuilding or redeploying the web app."
          : message,
      error?.code === "configuration_error" || keyMismatch || missingBrowserAuth
        ? "configuration_error"
        : undefined,
    );
  }
  return response.json();
}
export async function exportReport(path: string) {
  const client = supabase();
  const headers: Record<string, string> = {};
  if (client) {
    const { data } = await client.auth.getSession();
    if (data.session)
      headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  const response = await fetch(`/api/backend/${path}`, { headers });
  if (!response.ok) throw new ApiError(response.status, "Report export failed");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = "research-report.md";
  link.click();
  URL.revokeObjectURL(url);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: "configuration_error",
  ) {
    super(message);
    this.name = "ApiError";
  }
}
function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = body.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((item) =>
          typeof item?.msg === "string" ? item.msg : "Invalid value",
        )
        .join("; ");
    }
  }
  return `Request failed (${status})`;
}
