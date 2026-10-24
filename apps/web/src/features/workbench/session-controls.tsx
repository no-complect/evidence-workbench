"use client";

import { useMutation } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { useAuthIdentity } from "@/components/query-provider";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/error-notice";
import { supabase } from "@/lib/supabase";
import styles from "./notebook.module.css";

export function SessionControls() {
  const identity = useAuthIdentity();
  const signOut = useMutation({
    mutationFn: async () => {
      const client = supabase();
      if (!client) throw new Error("Supabase browser configuration is missing");
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) throw error;
    },
  });
  if (!identity) return null;
  return (
    <div className={styles.session} role="group" aria-label="Account">
      <span className={styles.identity} title={identity.email}>
        {identity.email ?? "Signed in"}
      </span>
      <Button
        variant="ghost"
        size="sm"
        disabled={signOut.isPending}
        aria-busy={signOut.isPending}
        help="Sign out of this browser session and clear its workspace queries and drafts."
        onClick={() => signOut.mutate()}
      >
        <LogOut size={14} />
        {signOut.isPending ? "Signing out…" : "Sign out"}
      </Button>
      <ErrorNotice error={signOut.error} onDismiss={signOut.reset} />
    </div>
  );
}
