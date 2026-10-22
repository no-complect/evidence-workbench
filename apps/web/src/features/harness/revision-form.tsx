"use client";
import { useRef, useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/error-notice";
import {
  initialResearchDraft,
  limitFields,
  parseLimits,
  submissionIntent,
  type SubmissionIntent,
} from "@/features/workbench/research-state";
import { stages, type HarnessState, type Stage } from "./contracts";
import { useSaveHarness } from "./queries";
import styles from "./harness.module.css";

export function RevisionForm({
  projectId,
  state,
}: {
  projectId: string;
  state: HarnessState;
}) {
  const [name, setName] = useState("Research baseline");
  const [targets, setTargets] = useState<Record<Stage, string>>({
    plan: "",
    assess: "",
    report: "",
  });
  const [limits, setLimits] = useState({ ...initialResearchDraft.limits });
  const [error, setError] = useState("");
  const intent = useRef<SubmissionIntent | null>(null);
  const save = useSaveHarness(projectId);
  const verified = state.checks.filter(
    (check) =>
      check.status === "verified" &&
      state.connections.some(
        (connection) =>
          connection.id === check.connection_id && connection.active,
      ),
  );
  function submit() {
    setError("");
    try {
      if (
        !name.trim() ||
        !Object.values(targets).every((id) =>
          verified.some((check) => check.id === id),
        )
      )
        throw new Error(
          "Name the revision and choose a verified model for each research stage.",
        );
      const body = { name: name.trim(), targets, limits: parseLimits(limits) };
      intent.current = submissionIntent(intent.current, body, () =>
        crypto.randomUUID(),
      );
      save.mutate({ ...body, idempotency_key: intent.current.key });
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Review revision settings.",
      );
    }
  }
  return (
    <form
      aria-label="Save harness revision"
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (!save.isPending) submit();
      }}
    >
      <label>
        Revision name
        <input
          required
          maxLength={100}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <div className={styles.targetGrid}>
        {stages.map(([stage, label]) => (
          <label key={stage}>
            {label} model
            <select
              aria-label={`${label} model`}
              required
              value={targets[stage]}
              onChange={(event) =>
                setTargets((previous) => ({
                  ...previous,
                  [stage]: event.target.value,
                }))
              }
            >
              <option value="">Choose a verified model</option>
              {verified.map((check) => (
                <option key={check.id} value={check.id}>
                  {
                    state.connections.find((c) => c.id === check.connection_id)
                      ?.name
                  }{" "}
                  / {check.request.model_id} · {check.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <details className={styles.budget}>
        <summary>Revision budgets</summary>
        <div className={styles.priceGrid}>
          {limitFields.map(([key, label, min, max]) => (
            <label key={key}>
              {label}
              <input
                type="number"
                required
                min={min}
                max={max}
                step={key === "estimated_cost_usd" ? 0.01 : 1}
                value={limits[key]}
                onChange={(event) =>
                  setLimits((previous) => ({
                    ...previous,
                    [key]: event.target.value,
                  }))
                }
              />
            </label>
          ))}
        </div>
      </details>
      <p className="fine-print">
        Save pins these task models, price estimates, budgets, prompt and
        contract hashes, context policy, and tool policy. Later changes require
        a new revision. Research runs keep their own snapshot.
      </p>
      <ErrorNotice error={error || save.error} />
      {save.isSuccess && (
        <p role="status">
          Saved immutable revision “{save.data.name}”. Select it under Research
          settings in Workflows.
        </p>
      )}
      <Button type="submit" disabled={save.isPending || !verified.length}>
        <Save size={15} />
        {save.isPending ? "Saving revision…" : "Save harness revision"}
      </Button>
    </form>
  );
}
