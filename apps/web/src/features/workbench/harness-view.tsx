import { Braces, Fingerprint, ShieldCheck } from "lucide-react";
import type { RunSnapshot } from "@/lib/contracts";
import { WorkspaceHeading } from "./workspace-shell";
import { limitFields } from "./research-state";
import {
  ModelSelector,
  type ModelSelectionProps,
} from "@/features/harness/model-selector";
import { stages } from "@/features/harness/contracts";
import styles from "./notebook.module.css";

export function HarnessView({
  snapshot,
  liveEnabled,
  modelSelection,
}: {
  snapshot: RunSnapshot | undefined;
  liveEnabled: boolean;
  modelSelection?: ModelSelectionProps;
}) {
  const run = snapshot?.detail.run;
  const contexts = snapshot?.detail.contexts ?? [];
  return (
    <>
      <WorkspaceHeading
        kicker="LLM HARNESS / EXECUTION BOUNDARY"
        title="Make the model boundary explicit."
      >
        Choose a model from the server’s configured provider, then inspect how
        each investigation uses its context and execution limits.
      </WorkspaceHeading>
      {modelSelection && (
        <section className={styles.surface} aria-label="Research model">
          <div className={styles.surfaceHead}>
            <Braces size={18} />
            Research model
          </div>
          <div className={styles.pad}>
            <ModelSelector {...modelSelection} />
          </div>
        </section>
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
                    {label}: {run.harness_snapshot!.targets[stage].model_id}
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
                      {context.payload.selected.length} /{" "}
                      {context.payload.excluded.length} passages
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
