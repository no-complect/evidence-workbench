import { Braces, Fingerprint, ShieldCheck } from "lucide-react";
import type { RunSnapshot } from "@/lib/contracts";
import { WorkspaceHeading } from "./workspace-shell";
import { limitFields } from "./research-state";
import styles from "./notebook.module.css";

export function HarnessView({
  snapshot,
  liveEnabled,
}: {
  snapshot: RunSnapshot | undefined;
  liveEnabled: boolean;
}) {
  const run = snapshot?.detail.run;
  const contexts = snapshot?.detail.contexts ?? [];
  return (
    <>
      <WorkspaceHeading
        kicker="LLM HARNESS / EXECUTION BOUNDARY"
        title="Make the model boundary explicit."
      >
        Inspect the execution limits and saved context behind an investigation.
      </WorkspaceHeading>
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
            <p className="fine-print">
              Provider connections, account-specific model discovery, and saved
              harness revisions are not available in this version.
            </p>
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
