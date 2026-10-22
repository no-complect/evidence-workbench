"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import { supabase } from "@/lib/supabase";

function QueryScope({ children }: { children: ReactNode }) {
  // One client per mounted user session, never shared across server requests.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            gcTime: 5 * 60_000,
            networkMode: "always", // local Docker works without an internet connection
            retry: (count, error) =>
              count < 2 &&
              (!(error instanceof ApiError) ||
                error.status === 429 ||
                error.status >= 500),
          },
          mutations: { retry: false, networkMode: "always" },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [principal, setPrincipal] = useState<string | null>(null);
  useEffect(() => {
    const subscription = supabase()?.auth.onAuthStateChange(
      (_event, session) => {
        setPrincipal(session?.user.id ?? null);
      },
    );
    return () => subscription?.data.subscription.unsubscribe();
  }, []);
  // Identity changes discard both cached server data and local workspace drafts.
  // Token refreshes for the same user preserve them. No data is persisted to disk.
  return <QueryScope key={principal ?? "anonymous"}>{children}</QueryScope>;
}
