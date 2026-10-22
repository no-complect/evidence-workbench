"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/error-notice";
import { supabase } from "@/lib/supabase";

export function AuthPanel() {
  const [email, setEmail] = useState("");
  const signIn = useMutation({
    mutationFn: async (email: string) => {
      const client = supabase();
      if (!client) throw new Error("Supabase browser configuration is missing");
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
    },
  });
  return (
    <form
      className="auth-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!signIn.isPending) signIn.mutate(email);
      }}
    >
      <label htmlFor="email">Sign in to your research workspace</label>
      <div className="flex-row">
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
        <Button type="submit" disabled={signIn.isPending}>
          Send sign-in link
        </Button>
      </div>
      <ErrorNotice error={signIn.error} onDismiss={signIn.reset} />
      {signIn.isSuccess && (
        <p role="status">Check your email for a sign-in link.</p>
      )}
    </form>
  );
}
