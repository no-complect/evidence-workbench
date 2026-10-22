"use client";
import { useRef, useState, type Dispatch } from "react";
import type { HarnessConfiguration } from "../../../../../packages/contracts/models";
import {
  ModelSelector,
  type ModelSelectionProps,
} from "@/features/harness/model-selector";
import {
  CircleDot,
  Database,
  Loader2,
  Search,
  Settings2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/error-notice";
import type { Collection } from "@/lib/contracts";
import { useStartResearch } from "./mutations";
import {
  DEFAULT_QUESTION,
  type ResearchDraft,
  type DraftAction,
  researchRequest,
  submissionIntent,
  limitFields,
  type ExecutionMode,
  type ResearchStrategy,
  type SubmissionIntent,
} from "./research-state";

export function ResearchComposer({
  projectId,
  research,
  configuration,
  modelSelection,
  collections,
  collectionId,
  examples,
  liveEnabled,
  running,
  onCollectionChange,
  onStarted,
}: {
  projectId: string;
  research: { draft: ResearchDraft; dispatch: Dispatch<DraftAction> };
  configuration: HarnessConfiguration;
  modelSelection?: ModelSelectionProps;
  collections: Collection[];
  collectionId: string;
  examples: string[];
  liveEnabled: boolean;
  running: boolean;
  onCollectionChange: (id: string) => void;
  onStarted: (id: string) => void;
}) {
  const { draft, dispatch } = research;
  const [showSettings, setShowSettings] = useState(false);
  const [validationError, setValidationError] = useState("");
  const intent = useRef<SubmissionIntent | null>(null);
  const mutation = useStartResearch(projectId);
  const { question, mode, strategy, limits, approval, webEnabled } = draft;
  const busy = mutation.isPending;
  const pricedModel =
    !!modelSelection?.catalog?.pricing_configured &&
    modelSelection.modelId === modelSelection.catalog.default_model;
  const collectionReady = collections.some(
    (item) =>
      item.id === collectionId &&
      (!item.setup_status || item.setup_status === "ready"),
  );
  const setQuestion = (value: string) => dispatch({ type: "question", value });
  const setMode = (value: ExecutionMode) => dispatch({ type: "mode", value });
  const setStrategy = (value: ResearchStrategy) =>
    dispatch({ type: "strategy", value });
  const setApproval = (value: boolean) => dispatch({ type: "approval", value });
  const setWebEnabled = (value: boolean) => dispatch({ type: "web", value });
  const setCollectionId = onCollectionChange;
  function start() {
    if (busy || running) return;
    setValidationError("");
    mutation.reset();
    try {
      const request = researchRequest(draft, collectionId);
      request.harness_config = configuration;
      if (mode === "live" && modelSelection) {
        if (!modelSelection.catalog?.models.includes(modelSelection.modelId))
          throw new Error(
            "Choose an available model. Refresh models if the catalog has changed.",
          );
        request.model_id = modelSelection.modelId;
      }
      intent.current = submissionIntent(intent.current, request, () =>
        crypto.randomUUID(),
      );
      mutation.mutate(
        { ...request, idempotency_key: intent.current.key },
        {
          onSuccess: (run) => {
            intent.current = null;
            onStarted(run.id);
          },
        },
      );
    } catch (error) {
      setValidationError(
        error instanceof Error ? error.message : "Check the research settings",
      );
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">WORKFLOWS / RESEARCH NOTEBOOK</div>
          <h1>Follow the work, not just the answer.</h1>
          <p>
            Plan the investigation. Inspect the evidence. Keep the uncertainty.
          </p>
        </div>
        <span className={`mode-badge ${mode}`}>
          <span />
          {mode === "demo" ? "SCRIPTED DEMO" : "LIVE INFERENCE"}
        </span>
      </div>
      <form
        className="composer"
        aria-labelledby="composer-title"
        onSubmit={(event) => {
          event.preventDefault();
          start();
        }}
      >
        <div className="composer-label">
          <span>
            <Sparkles size={16} />
            <label id="composer-title" htmlFor="question">
              What would you like to investigate?
            </label>
          </span>
          <span className="mono">NEW INVESTIGATION</span>
        </div>
        <textarea
          id="question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={3}
          maxLength={4000}
          minLength={10}
          required
        />
        <div className="example-row">
          <span>Try an example</span>
          {examples.slice(1, 4).map((q, i) => (
            <button type="button" key={q} onClick={() => setQuestion(q)}>
              {
                [
                  "Security requirements",
                  "Operating costs",
                  "Conflicting evidence",
                ][i]
              }
            </button>
          ))}
          <button type="button" onClick={() => setQuestion(DEFAULT_QUESTION)}>
            Full comparison
          </button>
        </div>
        <ErrorNotice
          error={validationError || mutation.error}
          onDismiss={() => {
            setValidationError("");
            mutation.reset();
          }}
        />
        <div className="composer-toolbar">
          <div className="composer-selects">
            <label>
              <Database size={15} />
              <span className="sr-only">Collection</span>
              <select
                value={collectionId}
                onChange={(e) => setCollectionId(e.target.value)}
              >
                <option value="" disabled>
                  Select a collection
                </option>
                {collections.map((c) => (
                  <option
                    key={c.id}
                    value={c.id}
                    disabled={!!c.setup_status && c.setup_status !== "ready"}
                  >
                    {c.name} · {c.document_count} docs
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={`settings-toggle ${showSettings ? "selected" : ""}`}
              onClick={() => setShowSettings(!showSettings)}
              aria-expanded={showSettings}
            >
              <Settings2 size={16} /> Research settings
            </button>
          </div>
          <Button
            type="submit"
            disabled={
              busy ||
              !projectId ||
              !collectionId ||
              !collectionReady ||
              question.trim().length < 10 ||
              running
            }
          >
            {busy ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Search size={16} />
            )}
            Start research
          </Button>
        </div>
        {showSettings && (
          <div className="settings-grid">
            <label>
              Execution mode
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as "demo" | "live")}
              >
                <option value="demo">Scripted demo · no paid calls</option>
                <option value="live" disabled={!liveEnabled}>
                  Live · {liveEnabled ? "configured" : "not configured"}
                </option>
              </select>
            </label>
            <label>
              Research strategy
              <select
                value={strategy}
                onChange={(e) => setStrategy(e.target.value as typeof strategy)}
              >
                <option value="agent">Bounded research</option>
                <option value="workflow">Fixed workflow</option>
                <option value="rag">Basic RAG</option>
              </select>
            </label>
            {mode === "live" && modelSelection && (
              <ModelSelector {...modelSelection} />
            )}
            {mode === "live" && modelSelection && !pricedModel && (
              <p className="fine-print">
                Dollar estimates are unavailable without server pricing
                configuration. Token, tool, iteration, and time limits still
                apply.
              </p>
            )}
            {limitFields
              .filter(
                ([key]) =>
                  mode !== "live" ||
                  pricedModel ||
                  key !== "estimated_cost_usd",
              )
              .map(([key, label, min, max]) => (
                <label key={key}>
                  {label}
                  <input
                    type="number"
                    required
                    min={min}
                    max={max}
                    step={key === "estimated_cost_usd" ? 0.01 : 1}
                    value={limits[key]}
                    onChange={(e) =>
                      dispatch({ type: "limit", key, value: e.target.value })
                    }
                  />
                </label>
              ))}
            <label className="check-label">
              <input
                type="checkbox"
                checked={approval}
                onChange={(e) => setApproval(e.target.checked)}
              />{" "}
              Review plan before research
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={webEnabled && mode === "live"}
                disabled={mode === "demo"}
                onChange={(e) => setWebEnabled(e.target.checked)}
              />{" "}
              Include public web sources
            </label>
          </div>
        )}
      </form>
      <div className="demo-note">
        <CircleDot size={14} />
        <span>
          {mode === "demo"
            ? "Synthetic documents. Scripted responses. Real retrieval, citations, and persisted execution."
            : "Live model calls use the server key and your execution limits. Dollar estimates are available only when pricing is configured."}
        </span>
        <span className="note-version">CORPUS v1</span>
      </div>
    </>
  );
}
