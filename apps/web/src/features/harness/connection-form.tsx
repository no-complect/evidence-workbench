"use client";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/error-notice";
import { harnessApi } from "./api";
import { harnessKey } from "./queries";
import styles from "./harness.module.css";

export function ConnectionForm({
  projectId,
  serverKey,
}: {
  projectId: string;
  serverKey: boolean;
}) {
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState(serverKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const secret = useRef<HTMLInputElement>(null);
  const locked = useRef(false);
  const client = useQueryClient();
  async function connect() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const promise = harnessApi.connect(projectId, {
        name: name.trim(),
        use_environment: environment,
        ...(!environment && { api_key: secret.current?.value ?? "" }),
      });
      if (secret.current) secret.current.value = "";
      await promise;
      setName("");
      await client.invalidateQueries({
        queryKey: harnessKey(projectId),
        exact: true,
      });
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Connection could not be saved.",
      );
    } finally {
      if (secret.current) secret.current.value = "";
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      className={styles.form}
      aria-label="Connect OpenAI"
      onSubmit={(event) => {
        event.preventDefault();
        void connect();
      }}
    >
      <label>
        Connection name
        <input
          required
          maxLength={100}
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          placeholder="Personal OpenAI project"
        />
      </label>
      <label>
        Credential source
        <select
          aria-label="Credential source"
          value={environment ? "server" : "key"}
          disabled={busy}
          onChange={(event) => {
            setEnvironment(event.target.value === "server");
            if (secret.current) secret.current.value = "";
          }}
        >
          <option value="key">Enter a key for this local instance</option>
          <option value="server" disabled={!serverKey}>
            Use server environment key{!serverKey && " · unavailable"}
          </option>
        </select>
      </label>
      {!environment && (
        <label>
          OpenAI API key
          <input
            ref={secret}
            type="password"
            autoComplete="off"
            spellCheck={false}
            required
            minLength={16}
            maxLength={512}
            disabled={busy}
          />
        </label>
      )}
      <p className="fine-print">
        <KeyRound size={13} /> Credentials stay encrypted on this local server.
        Connecting does not run inference. Embedding collections still use the
        server’s separately configured embedding profile. A connection keeps the
        credential captured when it was created; changing the environment key
        requires a new connection.
      </p>
      <ErrorNotice error={error} />
      <Button type="submit" disabled={busy || !name.trim()}>
        <Plus size={15} />
        {busy ? "Connecting…" : "Connect OpenAI"}
      </Button>
    </form>
  );
}
