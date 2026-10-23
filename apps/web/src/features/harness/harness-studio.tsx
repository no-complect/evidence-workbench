"use client";
import { type Dispatch } from "react";
import {
  SlidersHorizontal,
  Fingerprint,
  ShieldCheck,
  Check,
  ScanText,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpTip, Tooltip } from "@/components/ui/tooltip";
import { ContextView } from "@/components/context-view";
import type { Context } from "@/lib/contracts";
import type { HarnessConfiguration } from "../../../../../packages/contracts/models";
import type {
  ResearchDraft,
  DraftAction,
} from "@/features/workbench/research-state";
import { ModelSelector, type ModelSelectionProps } from "./model-selector";
import { ContractPreview } from "./contract-preview";
import { stages, type JudgeSelection } from "./contracts";
import styles from "./studio.module.css";

export function HarnessStudio({
  projectId,
  active,
  configuration,
  onChange,
  research,
  modelSelection,
  contexts,
  onOpenWorkflows,
  judgeSelection,
}: {
  projectId: string;
  active: boolean;
  configuration: HarnessConfiguration;
  onChange: (next: HarnessConfiguration) => void;
  research: { draft: ResearchDraft; dispatch: Dispatch<DraftAction> };
  modelSelection?: ModelSelectionProps;
  judgeSelection: JudgeSelection;
  contexts: Context[];
  onOpenWorkflows: () => void;
}) {
  return (
    <div className={styles.grid}>
      <section className={styles.surface} aria-label="Harness configuration">
        <div className={styles.head}>
          <span>
            <SlidersHorizontal size={16} />
            Harness configuration
            <HelpTip
              label="Harness configuration"
              content="These settings apply to future investigations. Saved runs keep their pinned instructions, model targets, source versions and limits."
            />
          </span>
          <small>Applied to the next investigation</small>
        </div>
        <div className={styles.pad}>
          <label className={styles.field}>
            Execution profile
            <Tooltip content="Fixture execution uses synthetic responses with real persisted retrieval and workflow state. Live execution uses the server's provider key and may incur charges; changing this setting does not start a run.">
              <select
                aria-label="Harness execution profile"
                value={research.draft.mode}
                onChange={(e) =>
                  research.dispatch({
                    type: "mode",
                    value: e.target.value as "demo" | "live",
                  })
                }
              >
                <option value="demo">
                  Deterministic fixture · no paid calls
                </option>
                <option
                  value="live"
                  disabled={
                    !modelSelection?.catalog?.live_enabled ||
                    !modelSelection.catalog.configured
                  }
                >
                  Live · server environment key
                </option>
              </select>
            </Tooltip>
          </label>
          {modelSelection && <ModelSelector {...modelSelection} compact />}
          <div className={styles.fields}>
            <label className={`${styles.field} ${styles.wide}`}>
              System instruction
              <textarea
                aria-label="System instruction"
                rows={4}
                maxLength={2000}
                value={configuration.system_instruction}
                onChange={(e) =>
                  onChange({
                    ...configuration,
                    system_instruction: e.target.value,
                  })
                }
              />
            </label>
            <label className={styles.field}>
              Context policy
              <Tooltip content="Controls how evidence is selected for model input. Balanced favors source diversity; Strict uses a smaller context. Excluded passages and reasons are saved for inspection.">
                <select
                  value={configuration.context_policy}
                  onChange={(e) =>
                    onChange({
                      ...configuration,
                      context_policy: e.target
                        .value as HarnessConfiguration["context_policy"],
                    })
                  }
                >
                  <option value="balanced">Balanced · source diversity</option>
                  <option value="strict">Strict · smaller context</option>
                </select>
              </Tooltip>
            </label>
            <label className={styles.field}>
              Maximum research iterations
              <select
                value={research.draft.limits.iterations}
                onChange={(e) =>
                  research.dispatch({
                    type: "limit",
                    key: "iterations",
                    value: e.target.value,
                  })
                }
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>
          <hr className={styles.rule} />
          <div className={styles.label}>PER-STAGE MODEL TARGETS</div>
          <div className={styles.fields}>
            {stages.map(([key, label]) => (
              <label className={styles.field} key={key}>
                {label}
                <Tooltip
                  content={`Override the model for ${label.toLowerCase()} only, or inherit the selected model. This changes future runs and makes no inference call.`}
                >
                  <select
                    aria-label={`${label} model`}
                    disabled={!modelSelection?.catalog?.configured}
                    value={configuration.stage_models[key] ?? ""}
                    onChange={(e) =>
                      onChange({
                        ...configuration,
                        stage_models: {
                          ...configuration.stage_models,
                          [key]: e.target.value || null,
                        },
                      })
                    }
                  >
                    <option value="">Use selected model</option>
                    {modelSelection?.catalog?.models.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                </Tooltip>
              </label>
            ))}
            <label className={styles.field}>
              Evaluation judge
              <Tooltip content="An optional model that grades sampled cited claims after evaluation research finishes. Selecting it makes no calls; grading requires a separate opt-in and paid authorization in Evaluations.">
                <select
                  aria-label="Evaluation judge model"
                  value={judgeSelection.modelId}
                  disabled={!modelSelection?.catalog?.configured}
                  onChange={(e) => judgeSelection.onChange(e.target.value)}
                >
                  <option value="">Off · deterministic checks only</option>
                  {modelSelection?.catalog?.models.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </Tooltip>
            </label>
          </div>
          <p className="fine-print">
            The judge is separate from the research reviewer. Selecting it makes
            no calls; enable and authorize grading in Evaluations.
          </p>
          <div className={styles.note}>
            <Fingerprint size={17} />
            <div>
              <strong>Configuration travels with the investigation.</strong>
              Prompts, context policy, model targets, source versions, and
              execution limits are recorded for each run. Changing this draft
              does not change saved runs.
            </div>
          </div>
          <hr className={styles.rule} />
          <div className={styles.label}>TOOL CONTRACT</div>
          <div className={styles.check}>
            <ShieldCheck size={16} />
            <span>
              <strong>corpus.search</strong> · read-only · project and
              collection scoped
            </span>
          </div>
          <div className={styles.check}>
            <Check size={16} />
            <span>
              Schema validation, approval, cancellation, and resource limits
              stay enforced.
            </span>
          </div>
          <details className={styles.context}>
            <summary>
              <ScanText
                size={14}
                style={{ display: "inline", verticalAlign: "middle" }}
              />{" "}
              Inspect assembled context
            </summary>
            {contexts.length ? (
              <ContextView contexts={contexts} />
            ) : (
              <div className={styles.annotation}>
                <strong>CONTEXT BOUNDARY</strong>Run an investigation to inspect
                its actual assembled inputs, selected and excluded passages,
                prompt hash, and token reservations. Source passages remain
                untrusted input.
              </div>
            )}
          </details>
          <div className={styles.actions}>
            <Button
              help="Open Workflows with this draft configuration. You still choose when to start research."
              onClick={onOpenWorkflows}
            >
              Investigate with this configuration <ArrowRight size={14} />
            </Button>
          </div>
        </div>
      </section>
      <ContractPreview projectId={projectId} active={active} />
    </div>
  );
}
