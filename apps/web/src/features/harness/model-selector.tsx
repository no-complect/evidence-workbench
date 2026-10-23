"use client";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
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
  compact?: boolean;
};
export function ModelSelector({
  catalog,
  fetching,
  error,
  modelId,
  onModelChange,
  onRefresh,
  compact = false,
}: ModelSelectionProps) {
  const available = catalog?.models ?? [];
  return (
    <div className={styles.form}>
      <label>
        Available model
        <Tooltip content="Choose a model discovered through the server's provider key. Discovery does not guarantee chat or structured-output compatibility; selection makes no inference calls.">
          <select
            aria-label="Available model"
            value={modelId}
            disabled={!catalog?.configured || !available.length}
            onChange={(event) => onModelChange(event.target.value)}
          >
            <option value="">
              {fetching ? "Loading models…" : "Choose a model"}
            </option>
            {!!modelId && !available.includes(modelId) && (
              <option value={modelId}>{modelId} · unavailable</option>
            )}
            {available.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </Tooltip>
      </label>
      <Button
        help="Refresh the model IDs available to the server's configured provider key. This discovers models; it does not run inference or change credentials."
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
          Set OPENAI_API_KEY or ANTHROPIC_API_KEY in the server environment,
          then restart the local services or redeploy.
        </p>
      ) : catalog ? (
        <p className="fine-print">
          {available.length} models available from the configured server
          providers. Selection makes no inference calls. This model will be used
          for the planner, reviewer, and writer.
        </p>
      ) : null}
      {catalog?.providers?.map((provider) =>
        provider.error ? (
          <p role="alert" className="fine-print" key={provider.provider}>
            {provider.error} Successfully loaded models remain available.
            Refresh models to retry.
          </p>
        ) : null,
      )}
      {catalog?.embeddings_configured === false && catalog.configured && (
        <p className="fine-print">
          Models can be inspected and saved. Live RAG also requires
          OPENAI_API_KEY for the collection’s OpenAI embeddings; Anthropic does
          not replace that index.
        </p>
      )}
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
      {!compact && (
        <p className="fine-print">
          All returned IDs are listed. Research requires a chat model that
          supports structured output; incompatible models report an execution
          error.
        </p>
      )}
    </div>
  );
}
