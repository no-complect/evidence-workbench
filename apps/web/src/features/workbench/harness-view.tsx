import type { Dispatch } from "react";
import type {
  HarnessConfiguration,
  HarnessPresetSettings,
} from "../../../../../packages/contracts/models";
import { HarnessPresets } from "@/features/harness/harness-presets";
import type { ResearchDraft, DraftAction } from "./research-state";
import { HarnessStudio } from "@/features/harness/harness-studio";
import { Braces, Fingerprint, ShieldCheck } from "lucide-react";
import type { RunSnapshot } from "@/lib/contracts";
import { WorkspaceHeading } from "./workspace-shell";
import { limitFields, parseLimits } from "./research-state";
import { type ModelSelectionProps } from "@/features/harness/model-selector";
import { stages, type JudgeSelection } from "@/features/harness/contracts";
import styles from "./notebook.module.css";

export function HarnessView({
  projectId,
  active,
  research,
  configuration,
  onConfigurationChange,
  onOpenWorkflows,
  snapshot,
  liveEnabled,
  modelSelection,
  judgeSelection,
  onApplyPreset,
}: {
  projectId: string;
  active: boolean;
  research: { draft: ResearchDraft; dispatch: Dispatch<DraftAction> };
  configuration: HarnessConfiguration;
  onConfigurationChange: (value: HarnessConfiguration) => void;
  onOpenWorkflows: () => void;
  snapshot: RunSnapshot | undefined;
  liveEnabled: boolean;
  modelSelection?: ModelSelectionProps;
  judgeSelection: JudgeSelection;
  onApplyPreset: (settings: HarnessPresetSettings) => void;
}) {
  const run = snapshot?.detail.run;
  const contexts = snapshot?.detail.contexts ?? [];
  let draft: HarnessPresetSettings | null = null;
  let draftError = "";
  try {
    draft = {
      configuration,
      limits: parseLimits(research.draft.limits),
      model_id: modelSelection?.modelId || null,
      judge_model_id: judgeSelection.modelId || null,
    };
  } catch (error) {
    draftError =
      error instanceof Error ? error.message : "Correct the draft limits.";
  }
  return (
    <>
      <WorkspaceHeading
        kicker="LLM HARNESS / CONFIGURATION STUDIO"
        title="Make the model boundary explicit."
      >
        Shape the request, constrain the response, and inspect the context. Each
        investigation keeps its configuration.
      </WorkspaceHeading>
      {!projectId ? (
        <p role="status">Select a project to configure its harness.</p>
      ) : (
        <HarnessStudio
          judgeSelection={judgeSelection}
          projectId={projectId}
          active={active}
          research={research}
          configuration={configuration}
          onChange={onConfigurationChange}
          modelSelection={modelSelection}
          savedRun={snapshot?.detail}
          onOpenWorkflows={onOpenWorkflows}
        />
      )}
      {projectId && (
        <HarnessPresets
          projectId={projectId}
          active={active}
          draft={draft}
          draftError={draftError}
          availableModels={modelSelection?.catalog?.models}
          onApply={onApplyPreset}
        />
      )}
      <div className={styles.twoColumns}>
        <section
          className={styles.surface}
          aria-label="Execution configuration"
        >
          <div className={styles.surfaceHead}>
            <Braces size={18} />
            Execution configuration
          </div>
          <div className={styles.pad}>
            {run ? (
              <dl className={styles.metrics}>
                <dt>Saved run</dt>
                <dd className="mono">{run.id}</dd>
                <dt>Execution mode</dt>
                <dd>
                  {run.mode === "demo"
                    ? "Deterministic fixture"
                    : "Live inference"}
                </dd>
                <dt>Strategy</dt>
                <dd>{run.strategy}</dd>
                {limitFields.map(([key, label]) => (
                  <div className="metric-pair" key={key}>
                    <dt>{label}</dt>
                    <dd>{run.request.limits[key]}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="fine-print">
                Start or select an investigation to inspect its saved execution
                configuration.
              </p>
            )}
            <div className={styles.note}>
              <ShieldCheck size={16} aria-hidden="true" />{" "}
              {liveEnabled
                ? "Live inference is configured on this instance. The Workflows form selects execution mode and budgets."
                : "This instance runs the self-contained fixture demo. No provider credentials or paid model calls are needed."}
            </div>
            {run?.harness_snapshot && (
              <div className={styles.note}>
                <strong>
                  Run model configuration: {run.harness_snapshot.name}
                </strong>
                {run.harness_snapshot.revision_id && (
                  <p className="mono">{run.harness_snapshot.revision_id}</p>
                )}
                {stages.map(([stage, label]) => (
                  <p key={stage}>
                    {label}: {run.harness_snapshot!.targets[stage].provider} /{" "}
                    {run.harness_snapshot!.targets[stage].model_id}
                  </p>
                ))}
              </div>
            )}
          </div>
        </section>
        <section className={styles.surface} aria-label="Saved context policy">
          <div className={styles.surfaceHead}>
            <Fingerprint size={18} />
            Saved context policy
          </div>
          <div className={styles.pad}>
            {contexts.length ? (
              contexts.map((context) => (
                <details key={context.id} className="harness-context">
                  <summary>
                    {context.stage} · {context.payload.prompt_id}
                  </summary>
                  <dl className={styles.metrics}>
                    <dt>Policy version</dt>
                    <dd>{context.payload.policy_version}</dd>
                    <dt>Prompt hash</dt>
                    <dd className="mono">{context.payload.prompt_hash}</dd>
                    <dt>Input estimate</dt>
                    <dd>{context.payload.input_tokens_estimate} tokens</dd>
                    <dt>Output reservation</dt>
                    <dd>{context.payload.output_token_reservation} tokens</dd>
                    <dt>Selected / excluded</dt>
                    <dd>
                      {context.payload.selected?.length ?? "not recorded"} /{" "}
                      {context.payload.excluded?.length ?? "not recorded"}{" "}
                      passages
                    </dd>
                  </dl>
                </details>
              ))
            ) : (
              <p className="fine-print">
                Saved prompt and context fingerprints appear after a run reaches
                a model boundary. Open Context in Workflows to inspect the
                assembled input.
              </p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
