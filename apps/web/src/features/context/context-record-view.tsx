import { Braces, ShieldCheck, TextQuote } from "lucide-react";
import type { Context, Evidence } from "@/lib/contracts";
import { savedContextInput } from "./context-record";
import { ContextPassages } from "./context-passages";
import { ContextDecisions } from "./context-decisions";
import styles from "./context.module.css";

export function ContextRecordView({
  context,
  evidence = [],
  onInspect,
}: {
  context: Context;
  evidence?: Evidence[];
  onInspect?: (evidence: Evidence) => void;
}) {
  const input = savedContextInput(context);
  const trace = context.payload;
  const byId = new Map(evidence.map((item) => [item.id, item]));
  return (
    <div className={styles.record}>
      <div className={styles.boundary}>
        <ShieldCheck size={18} aria-hidden="true" />
        <p>
          Saved inputs are separated by trust boundary. Source text is evidence,
          never an instruction. This view is redacted and does not expose
          private chain-of-thought.
        </p>
      </div>
      {input.structured ? (
        <>
          <div className={styles.columns}>
            <section
              className={styles.surface}
              aria-label="Trusted instructions"
            >
              <h3>
                <ShieldCheck size={16} aria-hidden="true" />
                Trusted instructions
              </h3>
              <p className={styles.caption}>
                The saved prompt and any harness instruction applied to this
                call.
              </p>
              <details>
                <summary>Read saved instructions</summary>
                <p className={styles.text}>
                  {input.instructions ??
                    "Instructions are unavailable in this saved record."}
                </p>
              </details>
            </section>
            <section className={styles.surface} aria-label="User requirements">
              <h3>
                <TextQuote size={16} aria-hidden="true" />
                User requirements
              </h3>
              <p className={styles.text}>
                {input.question ??
                  "The question is unavailable in this saved record."}
              </p>
              {input.summary !== undefined && (
                <details>
                  <summary>Saved workflow state</summary>
                  <p className={styles.caption}>
                    State carried into this call by the workflow, separate from
                    source passages.
                  </p>
                  <pre className={styles.json}>
                    {JSON.stringify(input.summary, null, 2)}
                  </pre>
                </details>
              )}
            </section>
          </div>
          <ContextPassages
            input={input}
            selected={trace.selected}
            evidenceById={byId}
            onInspect={onInspect}
          />
        </>
      ) : (
        <p className={styles.boundary} role="status">
          Structured context is unavailable for this record. Its redacted saved
          input is available below; source text has not been reconstructed.
        </p>
      )}
      <ContextDecisions
        selected={trace.selected}
        excluded={trace.excluded}
        evidenceById={byId}
        onInspect={onInspect}
      />
      <details className={styles.debug}>
        <summary>
          <Braces size={14} aria-hidden="true" />
          Raw saved input and fingerprints
        </summary>
        <div className="code-header">
          Assembled input<span>REDACTED</span>
        </div>
        <pre className={styles.json}>
          {JSON.stringify(trace.assembled_input, null, 2)}
        </pre>
        <dl className={styles.metadata}>
          <dt>Prompt</dt>
          <dd>{trace.prompt_id}</dd>
          <dt>Prompt SHA-256</dt>
          <dd>{trace.prompt_hash}</dd>
          <dt>Context policy</dt>
          <dd>{trace.policy_version}</dd>
          <dt>Token estimator</dt>
          <dd>{trace.token_estimator}</dd>
          <dt>Input token bound</dt>
          <dd>{trace.input_tokens_estimate}</dd>
          <dt>Output reservation</dt>
          <dd>{trace.output_token_reservation}</dd>
          {typeof trace.model_target?.provider === "string" && (
            <>
              <dt>Provider</dt>
              <dd>{trace.model_target.provider}</dd>
            </>
          )}
          {typeof trace.model_target?.model_id === "string" && (
            <>
              <dt>Model</dt>
              <dd>{trace.model_target.model_id}</dd>
            </>
          )}
          {typeof trace.model_target?.adapter === "string" && (
            <>
              <dt>Adapter</dt>
              <dd>{trace.model_target.adapter}</dd>
            </>
          )}
        </dl>
        <details>
          <summary>Saved trace metadata</summary>
          <pre className={styles.json}>
            {JSON.stringify({ ...trace, assembled_input: undefined }, null, 2)}
          </pre>
        </details>
      </details>
    </div>
  );
}
