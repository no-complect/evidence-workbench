"use client";
import { useReducer, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Play, FlaskConical, Layers } from "lucide-react";
import { EvaluationMeasurements } from "./evaluation-measurements";
import { EvaluationCasesEditor } from "./evaluation-cases-editor";
import {
  caseReducer,
  initialCaseDrafts,
  compileCases,
  type CaseAction,
} from "./case-state";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/error-notice";
import type { Collection, EvaluationSplit } from "@/lib/contracts";
import type {
  CustomEvaluation,
  HarnessConfiguration,
} from "../../../../../packages/contracts/models";
import { sourceOptions } from "@/features/workbench/queries";
import {
  parseLimits,
  type ResearchDraft,
} from "@/features/workbench/research-state";
import styles from "@/features/harness/studio.module.css";

export type EvaluationSetup = {
  collections: Collection[];
  collectionId: string;
  onCollectionChange: (id: string) => void;
  examples: string[];
  liveEnabled: boolean;
  modelId: string;
  configuration: HarnessConfiguration;
  limits: ResearchDraft["limits"];
};
export function EvaluationEditor({
  projectId,
  active,
  enabled,
  busy,
  pending,
  onSubmit,
  setup,
}: {
  projectId: string;
  active: boolean;
  enabled: boolean;
  busy: boolean;
  pending: boolean;
  onSubmit: (split: EvaluationSplit, custom?: CustomEvaluation) => void;
  setup?: EvaluationSetup;
}) {
  const [suite, setSuite] = useState("fixture");
  const [split, setSplit] = useState<EvaluationSplit>("development");
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [caseDrafts, dispatchCases] = useReducer(
    caseReducer,
    initialCaseDrafts,
  );
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const custom = suite === "collection";
  const sourceQuery = useQuery({
    ...sourceOptions(projectId, setup?.collectionId ?? ""),
    enabled: active && custom && !!setup?.collectionId,
  });
  const sources = (sourceQuery.data ?? []).filter((s) => s.current_version_id);
  const investigationCount = caseDrafts.cases.length * 3;
  function changeCases(action: CaseAction) {
    dispatchCases(action);
    setConfirmed(false);
    setError("");
  }
  function submit() {
    setError("");
    if (busy || pending) return;
    try {
      if (!custom) {
        onSubmit(split);
        return;
      }
      if (!setup?.collectionId) throw new Error("Select a ready collection.");
      if (mode === "live" && (!confirmed || !setup.modelId))
        throw new Error(
          "Select a model in Harness and authorize the paid comparison runs.",
        );
      onSubmit(split, {
        collection_id: setup.collectionId,
        mode,
        model_id: mode === "live" ? setup.modelId : null,
        harness_config: setup.configuration,
        limits: parseLimits(setup.limits),
        confirm_paid: mode === "live" && confirmed,
        cases: compileCases(
          caseDrafts,
          sources.map((s) => s.name),
          setup.examples,
          mode,
        ),
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Review evaluation expectations.",
      );
    }
  }
  return (
    <div className={styles.grid}>
      <section
        className={`${styles.surface} benchmark-launcher`}
        style={{ padding: 0, margin: 0 }}
        aria-label="Evaluation suite"
      >
        <div className={styles.head}>
          <span>
            <FlaskConical size={17} />
            Evaluation suite
          </span>
          <small>Pin expectations before execution</small>
        </div>
        <form
          className={styles.pad}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className={styles.fields}>
            <label className={styles.field}>
              Suite type
              <select
                aria-label="Suite type"
                value={suite}
                disabled={busy}
                onChange={(e) => {
                  setSuite(e.target.value);
                  setError("");
                }}
              >
                <option value="fixture">Built-in fixture benchmark</option>
                {setup && (
                  <option value="collection">
                    Collection-specific evaluation
                  </option>
                )}
              </select>
            </label>
            <label className={styles.field}>
              Dataset split
              <select
                aria-label="Dataset split"
                value={split}
                disabled={busy}
                onChange={(e) => setSplit(e.target.value as EvaluationSplit)}
              >
                <option value="development">Development</option>
                <option value="held-out">Held-out</option>
                <option value="all">All cases</option>
              </select>
            </label>
            {custom && setup && (
              <>
                <label className={`${styles.field} ${styles.wide}`}>
                  Evaluation collection
                  <select
                    aria-label="Evaluation collection"
                    value={setup.collectionId}
                    onChange={(e) => {
                      setup.onCollectionChange(e.target.value);
                      changeCases({ type: "collection" });
                    }}
                  >
                    <option value="" disabled>
                      Choose a collection
                    </option>
                    {setup.collections.map((c) => (
                      <option
                        key={c.id}
                        value={c.id}
                        disabled={
                          !!c.setup_status && c.setup_status !== "ready"
                        }
                      >
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  Evaluation mode
                  <select
                    aria-label="Evaluation mode"
                    value={mode}
                    onChange={(e) => {
                      setMode(e.target.value as typeof mode);
                      changeCases({ type: "mode" });
                      setConfirmed(false);
                    }}
                  >
                    <option value="demo">
                      Scripted fixture · no paid calls
                    </option>
                    <option value="live" disabled={!setup.liveEnabled}>
                      Live · selected Harness model
                    </option>
                  </select>
                </label>
                {mode === "live" && (
                  <div className={styles.wide}>
                    <p className="fine-print">
                      Model: {setup.modelId || "Choose a model in Harness"}.
                      This comparison runs {investigationCount} investigations
                      using your current per-run limits. Source ingestion is
                      separate. Dollar estimates may be unavailable.
                    </p>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                      />{" "}
                      I authorize paid calls for these {investigationCount}{" "}
                      evaluation runs.
                    </label>
                  </div>
                )}
              </>
            )}
          </div>
          {custom && setup && (
            <EvaluationCasesEditor
              state={caseDrafts}
              onChange={changeCases}
              sources={sources}
              examples={setup.examples}
              mode={mode}
            />
          )}
          <div className={styles.note}>
            <Layers size={17} />
            <div>
              <strong>
                {custom
                  ? "Review the expectations."
                  : "A fixed reference for comparison."}
              </strong>
              {custom
                ? "Source labels are human expectations. Corpus versions, configuration, and test cases are frozen at submission. Disclosure checks match text; they do not judge meaning."
                : "A fresh synthetic corpus and the built-in labeled questions are frozen for each job. No model credentials or paid calls are used."}
            </div>
          </div>
          <div className={styles.label} style={{ marginTop: 22 }}>
            STRATEGIES
          </div>
          <p className="fine-print">
            Basic RAG · fixed workflow · bounded research
            <br />
            Same corpus snapshot and configuration
          </p>
          <ErrorNotice error={error || sourceQuery.error} />
          <div className={styles.actions}>
            <Button
              type="submit"
              disabled={!projectId || busy || pending || (!custom && !enabled)}
            >
              <Play size={14} />
              {busy
                ? "Evaluation in progress"
                : custom
                  ? "Run collection evaluation"
                  : "Run benchmark"}
            </Button>
          </div>
          {!enabled && !custom && (
            <p role="status" className="fine-print">
              The fixture benchmark runs in local demo instances. Use a
              collection-specific live evaluation on this deployment.
            </p>
          )}
        </form>
      </section>
      <EvaluationMeasurements />
    </div>
  );
}
