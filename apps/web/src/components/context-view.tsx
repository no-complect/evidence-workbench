"use client";
import { useState } from "react";
import { Layers3, Terminal } from "lucide-react";

import { Empty } from "./empty";
import type { Context } from "@/lib/api";

export function ContextView({ contexts }: { contexts: Context[] }) {
  const [contextId, setContextId] = useState("");
  const chosenContext = contexts.find((c) => c.id === contextId) || contexts[0];
  return (
    <>
      <div className="section-title">
        <div>
          <h2>Context inspector</h2>
          <p>
            Redacted assembled inputs and selection decisions. No private
            chain-of-thought.
          </p>
        </div>
        {contexts.length ? (
          <select
            aria-label="Model call"
            value={chosenContext?.id}
            onChange={(e) => setContextId(e.target.value)}
          >
            {contexts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.call_key}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {chosenContext ? (
        <>
          <div className="context-stats">
            <div>
              <span>Prompt</span>
              <strong>{chosenContext.payload.prompt_id}</strong>
            </div>
            <div>
              <span>Context policy</span>
              <strong>{chosenContext.payload.policy_version}</strong>
            </div>
            <div>
              <span>Input token bound</span>
              <strong>
                {chosenContext.payload.input_tokens_estimate.toLocaleString()}
              </strong>
            </div>
            <div>
              <span>Selected / excluded</span>
              <strong>
                {chosenContext.payload.selected.length} /{" "}
                {chosenContext.payload.excluded.length}
              </strong>
            </div>
          </div>
          <p className="fine-print">
            Estimator: {chosenContext.payload.token_estimator}. Output
            reservation: {chosenContext.payload.output_token_reservation}{" "}
            tokens. Demo counts are estimates, not provider usage.
          </p>
          <details className="context-decisions">
            <summary>Evidence selection decisions</summary>
            {[
              ...chosenContext.payload.selected,
              ...chosenContext.payload.excluded,
            ].map((e) => (
              <p key={e.evidence_id}>
                <code>{e.evidence_id.slice(0, 8)}</code> {e.reason}
              </p>
            ))}
          </details>
          <div className="code-header">
            <Terminal size={14} />
            Assembled input<span>REDACTED</span>
          </div>
          <pre className="context-code">
            {JSON.stringify(chosenContext.payload.assembled_input, null, 2)}
          </pre>
          <p className="hash-text">
            Prompt SHA-256: {chosenContext.payload.prompt_hash}
          </p>
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
