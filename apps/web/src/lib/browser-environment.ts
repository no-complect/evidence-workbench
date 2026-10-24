type BrowserEnvironment = {
  NEXT_PUBLIC_AUTH_MODE?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
};

export function browserConfigurationIssues(env: BrowserEnvironment): string[] {
  const mode = env.NEXT_PUBLIC_AUTH_MODE || "demo";
  if (mode === "demo") return [];
  if (mode !== "supabase")
    return ["NEXT_PUBLIC_AUTH_MODE must be demo or supabase."];
  const issues: string[] = [];
  try {
    const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL || "");
    if (
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        )) ||
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
      "Set NEXT_PUBLIC_SUPABASE_URL to the Supabase HTTPS origin (loopback HTTP is allowed locally).",
    );
  }
  if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim())
    issues.push(
      "Set NEXT_PUBLIC_SUPABASE_ANON_KEY to the public anon/publishable key.",
    );
  return issues;
}

export function browserConfiguration() {
  // Explicit references are required for Next's build-time public substitution.
  return browserConfigurationIssues({
    NEXT_PUBLIC_AUTH_MODE: process.env.NEXT_PUBLIC_AUTH_MODE,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}
