"use client";
import { useState } from "react";
import { Layers3 } from "lucide-react";
import { Empty } from "./empty";
import { HelpTip } from "./ui/tooltip";
import type { Context, Evidence } from "@/lib/contracts";
import { ContextRecordView } from "@/features/context/context-record-view";
import styles from "@/features/context/context.module.css";

export function ContextView({
  contexts,
  evidence,
  onInspect,
}: {
  contexts: Context[];
  evidence?: Evidence[];
  onInspect?: (evidence: Evidence) => void;
}) {
  const [contextId, setContextId] = useState("");
  const chosen =
    contexts.find((context) => context.id === contextId) ?? contexts[0];
  return (
    <>
      <div className={styles.heading}>
        <div>
          <h2>
            Context inspector
            <HelpTip
              label="Context inspector"
              content="Inspect the redacted inputs saved for a model call, separated into instructions, user requirements, workflow state and untrusted passages. Selection reasons and source provenance stay inspectable. This is not private chain-of-thought."
            />
          </h2>
          <p>
            Follow what entered a model call, why it was selected, and where it
            came from.
          </p>
        </div>
        {chosen && (
          <label className={styles.call}>
            Model call
            <select
              aria-label="Model call"
              value={chosen.id}
              onChange={(event) => setContextId(event.target.value)}
            >
              {contexts.map((context) => (
                <option key={context.id} value={context.id}>
                  {context.stage} · {context.call_key}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {chosen ? (
        <>
          <div className={styles.stats}>
            <div>
              <span>Prompt</span>
              <strong>{chosen.payload.prompt_id}</strong>
            </div>
            <div>
              <span>Context policy</span>
              <strong>{chosen.payload.policy_version}</strong>
            </div>
            <div>
              <span>
                Input token bound
                <HelpTip
                  label="Input token bound"
                  content="A conservative bound used before execution, including schema/message overhead when recorded. This is not provider-reported usage; output tokens are reserved separately."
                />
              </span>
              <strong>
                {chosen.payload.input_tokens_estimate.toLocaleString()}
              </strong>
            </div>
            <div>
              <span>
                Selected / excluded
                <HelpTip
                  label="Context evidence selection"
                  content="Saved policy decisions for this model call. Excluded passages were not included in its source context."
                />
              </span>
              <strong>
                {chosen.payload.selected.length} /{" "}
                {chosen.payload.excluded.length}
              </strong>
            </div>
          </div>
          <p className="fine-print">
            Output reservation: {chosen.payload.output_token_reservation}{" "}
            tokens. These bounds are not provider-reported token usage.
          </p>
          <ContextRecordView
            key={chosen.id}
            context={chosen}
            evidence={evidence}
            onInspect={onInspect}
          />
        </>
      ) : (
        <Empty
          icon={Layers3}
          title="Every call has a context"
          text="After planning starts, inspect prompt versions, token estimates, selected evidence, and exclusion reasons here."
        />
      )}
    </>
  );
}
