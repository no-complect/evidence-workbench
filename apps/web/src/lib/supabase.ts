import { createClient } from "@supabase/supabase-js";
import { browserConfiguration } from "./browser-environment";

let client: ReturnType<typeof createClient> | null = null;

export function supabase() {
  if (
    process.env.NEXT_PUBLIC_AUTH_MODE !== "supabase" ||
    browserConfiguration().length
  )
    return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client ??= createClient(url, key);
  return client;
}
