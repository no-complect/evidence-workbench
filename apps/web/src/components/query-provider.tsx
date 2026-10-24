"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import { supabase } from "@/lib/supabase";

type AuthIdentity = { id: string; email: string | undefined } | null;
const AuthIdentityContext = createContext<AuthIdentity>(null);
export const useAuthIdentity = () => useContext(AuthIdentityContext);

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
                (error.status >= 500 && error.code !== "configuration_error")),
          },
          mutations: { retry: false, networkMode: "always" },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<AuthIdentity>(null);
  useEffect(() => {
    const subscription = supabase()?.auth.onAuthStateChange(
      (_event, session) => {
        setIdentity((previous) => {
          const user = session?.user;
          if (!user) return null;
          return previous?.id === user.id && previous.email === user.email
            ? previous
            : { id: user.id, email: user.email };
        });
      },
    );
    return () => subscription?.data.subscription.unsubscribe();
  }, []);
  // Identity changes discard both cached server data and local workspace drafts.
  // Token refreshes for the same user preserve them. No data is persisted to disk.
  return (
    <AuthIdentityContext value={identity}>
      <QueryScope key={identity?.id ?? "anonymous"}>{children}</QueryScope>
    </AuthIdentityContext>
  );
}
