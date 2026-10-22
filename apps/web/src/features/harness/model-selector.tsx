"use client";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/error-notice";
import type { ModelCatalog } from "./contracts";
import styles from "./harness.module.css";

export type ModelSelectionProps = {
  catalog: ModelCatalog | undefined;
  fetching: boolean;
  error: Error | null;
  modelId: string;
  onModelChange: (id: string) => void;
  onRefresh: () => void;
};
export function ModelSelector({
  catalog,
  fetching,
  error,
  modelId,
  onModelChange,
  onRefresh,
}: ModelSelectionProps) {
  const available = catalog?.models ?? [];
  return (
    <div className={styles.form}>
      <label>
        Available model
        <select
          aria-label="Available model"
          value={available.includes(modelId) ? modelId : ""}
          disabled={!catalog?.configured || !available.length}
          onChange={(event) => onModelChange(event.target.value)}
        >
          <option value="">
            {fetching ? "Loading models…" : "Choose a model"}
          </option>
          {available.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>
      <Button
        type="button"
        variant="secondary"
        disabled={fetching}
        onClick={onRefresh}
      >
        <RefreshCw size={14} />
        {fetching ? "Loading models…" : "Refresh models"}
      </Button>
      <ErrorNotice error={error} />
      {catalog && !catalog.configured ? (
        <p className="fine-print">
          Set OPENAI_API_KEY in the server environment, then restart the local
          services or redeploy.
        </p>
      ) : catalog ? (
        <p className="fine-print">
          {available.length} models available from the server’s OpenAI key.
          Selection makes no inference calls. This model will be used for the
          planner, reviewer, and writer.
        </p>
      ) : null}
      {!!catalog?.configured && !available.length && (
        <p role="status" className="fine-print">
          The provider returned no models for this key.
        </p>
      )}
      {catalog?.configured && !catalog.live_enabled && (
        <p className="fine-print">
          Model selection is available. Set LIVE_ENABLED=true on the server to
          enable paid workflow execution.
        </p>
      )}
      <p className="fine-print">
        All returned IDs are listed. Research requires a chat model that
        supports structured output; incompatible models report an execution
        error.
      </p>
    </div>
  );
}
