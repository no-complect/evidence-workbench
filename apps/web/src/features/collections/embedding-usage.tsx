"use client";
import { useQuery } from "@tanstack/react-query";
import { ErrorNotice } from "@/components/error-notice";
import { workbenchApi } from "@/lib/workbench-api";
import {
  embeddingUsageKey,
  estimatedEmbeddingCost,
} from "./embedding-usage-state";
import styles from "./collections.module.css";

export function EmbeddingUsage({
  projectId,
  collectionId,
  preparing,
  enabled = true,
}: {
  projectId: string;
  collectionId: string;
  preparing: boolean;
  enabled?: boolean;
}) {
  const usage = useQuery({
    queryKey: embeddingUsageKey(projectId, collectionId),
    queryFn: ({ signal }) =>
      workbenchApi.embeddingUsage(projectId, collectionId, signal),
    enabled: enabled && !!projectId && !!collectionId,
    retry: false,
    refetchInterval: enabled && preparing ? 1000 : false,
  });
  if (!collectionId || !enabled) return null;
  const data = usage.data;
  return (
    <section className={styles.batch} aria-label="Embedding usage">
      <h3>Embedding usage</h3>
      <ErrorNotice
        title="Embedding usage unavailable"
        error={usage.error}
        onRetry={() => void usage.refetch()}
      />
      {usage.isPending ? (
        <p role="status">Loading recorded usage…</p>
      ) : (
        data && (
          <>
            {data.summary.requests === 0 ? (
              <p>No embedding requests recorded.</p>
            ) : (
              <p>
                {data.summary.reported_tokens === null
                  ? "No token usage reported"
                  : `${data.summary.reported_tokens.toLocaleString()} reported tokens`}
                {" · "}
                {data.summary.requests} recorded requests{" · "}
                {data.summary.unreported_requests} with unreported usage
                {" · "}
                {estimatedEmbeddingCost(data.summary.estimated_cost_usd)}
              </p>
            )}
            {data.requests.length > 0 && (
              <details>
                <summary>
                  Inspect latest {data.requests.length} requests
                </summary>
                <ul className={styles.files}>
                  {data.requests.map((request) => (
                    <li key={request.id}>
                      <div>
                        <strong>
                          {request.model} · {request.dimensions} dimensions
                        </strong>
                        <p>
                          {request.reported_tokens === null
                            ? "Usage unreported"
                            : `${request.reported_tokens.toLocaleString()} reported tokens`}
                          {" · "}
                          {estimatedEmbeddingCost(request.estimated_cost_usd)}
                        </p>
                        <p className="fine-print">
                          {request.input_count} passages · input bound{" "}
                          {request.input_token_bound.toLocaleString()} tokens.
                          Rate per million:{" "}
                          {request.usd_per_million ?? "unknown"}.
                        </p>
                        <dl className={styles.usageMetadata}>
                          <dt>Target source version</dt>
                          <dd>{request.source_version_id}</dd>
                          <dt>Input fingerprint</dt>
                          <dd>{request.input_hash}</dd>
                          <dt>Provider request</dt>
                          <dd>
                            {request.provider_request_id ?? "Not reported"}
                          </dd>
                        </dl>
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <p className="fine-print">
              Recorded file preparation only; research and retrieval usage are
              separate. Earlier uploads may predate tracking. Fixture indexing
              and reused versions make no provider calls. Estimates use the rate
              saved for each attempt and are not a billing guarantee.
            </p>
          </>
        )
      )}
    </section>
  );
}
