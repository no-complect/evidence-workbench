"use client";
import { useReducer, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Play, FlaskConical, Layers, Loader2 } from "lucide-react";
import { JudgingOptions } from "./judging-options";
import {
  initialJudgeDraft,
  parseJudgeDraft,
  type JudgeDraft,
} from "./judge-state";
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
import controls from "./evaluation-controls.module.css";
import layout from "./evaluation-layout.module.css";
import { HelpTip } from "@/components/ui/tooltip";

export type EvaluationSetup = {
  collections: Collection[];
  collectionId: string;
  onCollectionChange: (id: string) => void;
  examples: string[];
  liveEnabled: boolean;
  modelId: string;
  judgeModelId: string;
  judgePricesKnown: boolean;
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
  const [consent, setConsent] = useState<string | null>(null);
  const [judgeEnabled, setJudgeEnabled] = useState(false);
  const [judgeDraft, setJudgeDraft] = useState(initialJudgeDraft);
  const [error, setError] = useState("");
  const custom = suite === "collection";
  const sourceQuery = useQuery({
    ...sourceOptions(projectId, setup?.collectionId ?? ""),
    enabled: active && custom && !!setup?.collectionId,
  });
  const sources = (sourceQuery.data ?? []).filter((s) => s.current_version_id);
  const investigationCount = caseDrafts.cases.length * 3;
  const judge =
    mode === "live" && judgeEnabled && setup?.judgeModelId
      ? {
          model_id: setup.judgeModelId,
          ...judgeDraft,
        }
      : null;
  const consentIntent = JSON.stringify({
    mode,
    collectionId: setup?.collectionId,
    model: setup?.modelId,
    configuration: setup?.configuration,
    limits: setup?.limits,
    cases: caseDrafts.cases,
    judge,
  });
  const confirmed = consent === consentIntent;
  function changeCases(action: CaseAction) {
    dispatchCases(action);
    setConsent(null);
    setError("");
  }
  function changeJudge(key: keyof JudgeDraft, value: string) {
    setJudgeDraft((previous) => ({ ...previous, [key]: value }));
    setConsent(null);
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
      if (mode === "live" && judgeEnabled && !judge)
        throw new Error(
          "Select an evaluation judge in Harness or disable semantic judging.",
        );
      onSubmit(split, {
        collection_id: setup.collectionId,
        mode,
        model_id: mode === "live" ? setup.modelId : null,
        harness_config: setup.configuration,
        limits: parseLimits(setup.limits),
        confirm_paid: mode === "live" && confirmed,
        judge: judge
          ? parseJudgeDraft(judgeDraft, judge.model_id, setup.judgePricesKnown)
          : null,
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
    <div className={`${styles.grid} ${layout.setup}`}>
      <section
        className={`${styles.surface} benchmark-launcher`}
        style={{ padding: 0, margin: 0 }}
        aria-label="Evaluation suite"
      >
        <div className={`${styles.head} ${layout.setupHeading}`}>
          <span>
            <FlaskConical size={17} />
            Evaluation suite
            <HelpTip
              label="Evaluation suite"
              content="Run the same cases through RAG, a fixed workflow and bounded research. Sources, configuration and expectations are pinned at submission so the comparison can be inspected later."
            />
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
                      setConsent(null);
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
          {custom && setup && (
            <JudgingOptions
              live={mode === "live"}
              modelId={setup.judgeModelId}
              enabled={judgeEnabled}
              onEnabled={(value) => {
                setJudgeEnabled(value);
                setConsent(null);
                setError("");
              }}
              draft={judgeDraft}
              onChange={changeJudge}
              pricesKnown={setup.judgePricesKnown}
            />
          )}
          {custom && mode === "live" && (
            <div style={{ marginTop: 18 }}>
              <p className="fine-print">
                Research model: {setup?.modelId || "Choose a model in Harness"}.{" "}
                {investigationCount} investigations use your current per-run
                limits. Ingestion is separate.
              </p>
              <label className={controls.checkbox}>
                <input
                  type="checkbox"
                  aria-label="Authorize paid evaluation"
                  checked={confirmed}
                  onChange={(e) => {
                    setConsent(e.target.checked ? consentIntent : null);
                    setError("");
                  }}
                />
                <span>
                  I authorize paid calls for these {investigationCount}{" "}
                  evaluation runs
                  {judge
                    ? ` and up to ${investigationCount * Number(judgeDraft.max_claims_per_run)} sampled claim judgments`
                    : ""}
                  .
                </span>
              </label>
            </div>
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
              help={
                custom
                  ? "Queue three strategy investigations per case with the current frozen settings. Scripted mode uses fixtures; live mode makes the explicitly authorized model calls."
                  : "Queue a reproducible synthetic benchmark across three strategies. The worker executes it independently of the browser; no paid model calls are made."
              }
              disabled={!projectId || busy || pending || (!custom && !enabled)}
              aria-busy={busy}
              className={busy ? controls.running : undefined}
            >
              {busy ? (
                <Loader2
                  size={16}
                  className={controls.spinner}
                  aria-hidden="true"
                />
              ) : (
                <Play size={14} aria-hidden="true" />
              )}
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
