import "server-only";

export function proxyConfigurationIssues(env: NodeJS.ProcessEnv): string[] {
  const issues: string[] = [];
  const local = env.APP_ENV === "local" || env.APP_ENV === "test";
  if (!local && env.APP_ENV !== "production")
    issues.push("Set APP_ENV to local, test, or production on the web server.");
  const base = env.API_URL || (local ? "http://127.0.0.1:8000" : "");
  try {
    const url = new URL(base);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      (!local && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.port === "0" ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error();
  } catch {
    issues.push(
      local
        ? "API_URL must be a valid HTTP(S) API origin."
        : "Set API_URL to the deployed HTTPS API origin.",
    );
  }
  if (!local) {
    if (
      !env.API_SHARED_SECRET?.trim() ||
      env.API_SHARED_SECRET.trim().length < 32 ||
      env.API_SHARED_SECRET.startsWith("local-")
    )
      issues.push(
        "Set API_SHARED_SECRET to the same random secret (32+ characters) on the web server and API.",
      );
    if (env.NEXT_PUBLIC_AUTH_MODE !== "supabase")
      issues.push(
        "Set NEXT_PUBLIC_AUTH_MODE=supabase before building the deployed web app.",
      );
    try {
      const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL || "");
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port === "0" ||
        url.search ||
        url.hash ||
        url.pathname !== "/"
      )
        throw new Error();
    } catch {
      issues.push(
        "Set NEXT_PUBLIC_SUPABASE_URL to the Supabase HTTPS origin before building the web app.",
      );
    }
    if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim())
      issues.push(
        "Set NEXT_PUBLIC_SUPABASE_ANON_KEY before building the web app.",
      );
  }
  return issues;
}
