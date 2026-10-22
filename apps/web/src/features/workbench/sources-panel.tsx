"use client";

import { useQuery } from "@tanstack/react-query";
import { ErrorNotice } from "@/components/error-notice";
import { SourcesView } from "@/components/sources-view";
import { sourceOptions } from "./queries";
import { useUploadSource } from "./mutations";

export function SourcesPanel({
  projectId,
  collectionId,
  readOnly,
  onCreate,
}: {
  projectId: string;
  collectionId: string;
  readOnly: boolean;
  onCreate: () => void;
}) {
  const sources = useQuery(sourceOptions(projectId, collectionId));
  const upload = useUploadSource(projectId, collectionId);
  return (
    <>
      <ErrorNotice
        title="Sources could not load"
        error={sources.error}
        onRetry={() => void sources.refetch()}
      />
      <ErrorNotice error={upload.error} onDismiss={upload.reset} />
      {!!collectionId && sources.isPending && (
        <p role="status">Loading sources…</p>
      )}
      <SourcesView
        sources={sources.data ?? []}
        canCreate={!!projectId}
        canUpload={!!collectionId && !readOnly}
        readOnly={readOnly}
        busy={upload.isPending}
        onCreate={onCreate}
        onUpload={(file) => upload.mutate(file)}
      />
      {upload.isSuccess && (
        <p role="status">Source uploaded. The collection is up to date.</p>
      )}
    </>
  );
}
