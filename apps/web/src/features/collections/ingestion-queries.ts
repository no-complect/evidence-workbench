"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { workbenchApi } from "@/lib/workbench-api";
import type { IngestionJob } from "@/lib/contracts";
import { workspaceKeys } from "@/features/workbench/queries";
import { activeIngestion } from "./ingestion-state";
import { embeddingUsageKey } from "./embedding-usage-state";

export const ingestionKey = (project: string) =>
  ["workbench", "project", project, "ingestions"] as const;

export function useIngestionJobs(project: string) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ingestionKey(project),
    queryFn: ({ signal }) => workbenchApi.ingestionJobs(project, signal),
    enabled: !!project,
    refetchInterval: (query) =>
      query.state.data?.some(activeIngestion) ? 1_000 : 5_000,
  });
  useEffect(() => {
    if (!query.data) return;
    // Synchronize server projections after saved phase/outcome changes, never mirror records.
    for (const collection of new Set(
      query.data.map((job) => job.collection_id),
    )) {
      void client.invalidateQueries({
        queryKey: workspaceKeys.sources(project, collection),
        exact: true,
      });
      void client.invalidateQueries({
        queryKey: embeddingUsageKey(project, collection),
        exact: true,
      });
    }
    void client.invalidateQueries({
      queryKey: workspaceKeys.project(project),
      exact: true,
    });
  }, [client, project, query.data]);
  const action = useMutation({
    mutationFn: ({
      job,
      operation,
    }: {
      job: string;
      operation: "retry" | "cancel";
    }) =>
      operation === "retry"
        ? workbenchApi.retryIngestion(project, job)
        : workbenchApi.cancelIngestion(project, job),
    retry: false,
    onSuccess: (job) => {
      client.setQueryData<IngestionJob[]>(ingestionKey(project), (old) => [
        ...(old ?? []).filter((item) => item.id !== job.id),
        job,
      ]);
    },
    onSettled: () =>
      client.invalidateQueries({
        queryKey: ingestionKey(project),
        exact: true,
      }),
  });
  return { query, action };
}
