"use client";

import { useQuery } from "@tanstack/react-query";
import { ErrorNotice } from "@/components/error-notice";
import { SourcesView } from "@/components/sources-view";
import { sourceOptions } from "./queries";
import { UploadBatch } from "@/features/collections/upload-batch";
import type { UploadQueue } from "@/features/collections/use-upload-queue";
import { EmbeddingUsage } from "@/features/collections/embedding-usage";

export function SourcesPanel({
  projectId,
  collectionId,
  readOnly,
  uploads,
  ready = true,
  active = true,
}: {
  projectId: string;
  collectionId: string;
  readOnly: boolean;
  uploads: UploadQueue;
  ready?: boolean;
  active?: boolean;
}) {
  const sources = useQuery({
    ...sourceOptions(projectId, collectionId),
    enabled: active && !!projectId && !!collectionId,
  });
  return (
    <>
      <ErrorNotice
        title="Sources could not load"
        error={sources.error}
        onRetry={() => void sources.refetch()}
      />
      {!!collectionId && sources.isPending && (
        <p role="status">Loading sources…</p>
      )}
      <SourcesView
        sources={sources.data ?? []}
        canUpload={!!collectionId && !readOnly && ready}
        readOnly={readOnly}
        busy={uploads.busy}
        onUpload={(files) => void uploads.add(collectionId, files)}
      />
      <UploadBatch queue={uploads} collectionId={collectionId} />
      <EmbeddingUsage
        key={collectionId}
        projectId={projectId}
        collectionId={collectionId}
        preparing={uploads.preparing(collectionId)}
        enabled={active}
      />
    </>
  );
}
