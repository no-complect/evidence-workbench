"use client";
import { useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/error-notice";
import {
  submissionIntent,
  type SubmissionIntent,
} from "@/features/workbench/research-state";
import type { Connection, Verification } from "./contracts";
import { useVerification } from "./queries";
import styles from "./harness.module.css";
export function ModelVerification({
  projectId,
  connection,
  checks,
  liveEnabled,
}: {
  projectId: string;
  connection: Connection;
  checks: Verification[];
  liveEnabled: boolean;
}) {
  const [modelId, setModelId] = useState("");
  const [inputPrice, setInputPrice] = useState("");
  const [outputPrice, setOutputPrice] = useState("");
  const [cap, setCap] = useState("0.05");
  const [error, setError] = useState("");
  const intent = useRef<SubmissionIntent | null>(null);
  const mutation = useVerification(projectId, connection.id);
  const active = connection.active && liveEnabled;
  function verify() {
    setError("");
    const body = {
      model_id: modelId,
      input_usd_per_million: Number(inputPrice),
      output_usd_per_million: Number(outputPrice),
      max_cost_usd: Number(cap),
    };
    if (
      !modelId ||
      ![
        body.input_usd_per_million,
        body.output_usd_per_million,
        body.max_cost_usd,
      ].every((n) => Number.isFinite(n) && n > 0)
    ) {
      setError(
        "Select a model and enter positive price estimates and a budget.",
      );
      return;
    }
    intent.current = submissionIntent(
      intent.current,
      { connection: connection.id, ...body },
      () => crypto.randomUUID(),
    );
    mutation.mutate({ ...body, idempotency_key: intent.current.key });
  }
  return (
    <section
      aria-label="Verify model contracts"
      className={styles.verification}
    >
      <h3>Verify a model for research</h3>
      <p className="fine-print">
        Catalog access does not prove inference access. This explicit test makes
        up to three paid structured-output calls against the planner, reviewer
        and writer contracts. Prices are your estimates, not provider billing
        guarantees.
      </p>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!mutation.isPending) verify();
        }}
      >
        <label>
          Available model
          <select
            aria-label="Available model"
            required
            value={modelId}
            disabled={!active || mutation.isPending}
            onChange={(event) => setModelId(event.target.value)}
          >
            <option value="">Choose a discovered model</option>
            {connection.catalog.map((id) => (
              <option value={id} key={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.priceGrid}>
          <label>
            Input USD / million
            <input
              required
              type="number"
              min="0.000001"
              max="1000"
              step="any"
              value={inputPrice}
              onChange={(event) => setInputPrice(event.target.value)}
            />
          </label>
          <label>
            Output USD / million
            <input
              required
              type="number"
              min="0.000001"
              max="10000"
              step="any"
              value={outputPrice}
              onChange={(event) => setOutputPrice(event.target.value)}
            />
          </label>
          <label>
            Probe budget · USD
            <input
              required
              type="number"
              min="0.000001"
              max="1"
              step="any"
              value={cap}
              onChange={(event) => setCap(event.target.value)}
            />
          </label>
        </div>
        {!liveEnabled && (
          <p role="status" className="fine-print">
            Live calls are disabled on the server. Model discovery remains
            available.
          </p>
        )}
        <ErrorNotice error={error || mutation.error} />
        <Button
          type="submit"
          disabled={!active || !modelId || mutation.isPending}
        >
          <ShieldCheck size={15} />
          {mutation.isPending
            ? "Checking contracts…"
            : "Run paid capability check"}
        </Button>
      </form>
      {mutation.data && mutation.data.status !== "checking" && (
        <Button
          variant="ghost"
          onClick={() => {
            intent.current = null;
            mutation.reset();
          }}
        >
          Prepare another capability check
        </Button>
      )}
      <ul className={styles.checks}>
        {checks.map((check) => (
          <li key={check.id}>
            <strong>{check.request.model_id}</strong>
            <span className={`status-badge ${check.status}`}>
              {check.status}
            </span>
            <small>
              Reserved estimate ${Number(check.estimated_cost).toFixed(4)}
              {check.actual_cost !== null &&
                ` · reported estimate $${Number(check.actual_cost).toFixed(4)}`}
            </small>
            {check.error && <p className="source-error">{check.error}</p>}
            {check.status === "checking" && (
              <p className="fine-print">
                Checking or waiting for a prior request. An interrupted check is
                never automatically replayed.
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
