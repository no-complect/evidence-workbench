"use client";

import { useReducer, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { workbenchApi } from "@/lib/workbench-api";
import { MAX_BATCH_FILES, sourceFileError } from "@/lib/ingestion";
import { workspaceKeys } from "@/features/workbench/queries";
import { uploadReducer, type UploadRow } from "./upload-state";
import { ingestionKey, useIngestionJobs } from "./ingestion-queries";
import { activeIngestion, latestPreparations } from "./ingestion-state";
import type { IngestionJob } from "@/lib/contracts";

// Project-owned file intent survives switching collections/workspaces; records stay in queries.
export function useUploadQueue(projectId: string) {
  const [rows, dispatch] = useReducer(uploadReducer, []);
  const [busy, setBusy] = useState(false);
  const [batchError, setBatchError] = useState("");
  const locked = useRef(false);
  const client = useQueryClient();
  const { query: jobs, action } = useIngestionJobs(projectId);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  async function execute(batch: UploadRow[]) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      for (const row of batch) {
        if (row.status === "invalid") continue;
        dispatch({
          type: "update",
          id: row.id,
          patch: { status: "uploading", error: undefined },
        });
        try {
          const job = await workbenchApi.upload(
            projectId,
            row.collectionId,
            row.file,
            row.id,
          );
          client.setQueryData<IngestionJob[]>(
            ingestionKey(projectId),
            (old) => [...(old ?? []).filter((item) => item.id !== job.id), job],
          );
          dispatch({ type: "submitted", id: row.id });
        } catch (error) {
          dispatch({
            type: "update",
            id: row.id,
            patch: {
              status: "failed",
              error:
                error instanceof Error
                  ? error.message
                  : "Upload failed; retry this file.",
            },
          });
        }
        await Promise.all([
          client.invalidateQueries({
            queryKey: workspaceKeys.sources(projectId, row.collectionId),
            exact: true,
          }),
          client.invalidateQueries({
            queryKey: ingestionKey(projectId),
            exact: true,
          }),
          client.invalidateQueries({
            queryKey: workspaceKeys.project(projectId),
            exact: true,
          }),
        ]);
      }
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function add(collectionId: string, files: File[]) {
    if (!projectId || !collectionId || locked.current) return;
    if (files.length > MAX_BATCH_FILES) {
      setBatchError(`Choose at most ${MAX_BATCH_FILES} files per batch.`);
      return;
    }
    setBatchError("");
    const batch: UploadRow[] = files.map((file) => {
      const error = sourceFileError(file);
      return {
        id: crypto.randomUUID(),
        collectionId,
        file,
        status: error ? "invalid" : "queued",
        error: error ?? undefined,
      };
    });
    dispatch({ type: "add", rows: batch });
    await execute(batch);
  }
  return {
    rows,
    jobs: jobs.data ?? [],
    visibleJobs: latestPreparations(jobs.data ?? []).filter(
      (job) => !dismissed.has(job.id),
    ),
    jobsError: jobs.error,
    refreshJobs: jobs.refetch,
    actionError: action.error,
    actionPending: action.isPending,
    retryJob: (job: string) => action.mutate({ job, operation: "retry" }),
    cancelJob: (job: string) => action.mutate({ job, operation: "cancel" }),
    preparing: (collection: string) =>
      jobs.data?.some(
        (job) => job.collection_id === collection && activeIngestion(job),
      ) ?? false,
    busy,
    batchError,
    add,
    retry: (id: string) => {
      const row = rows.find((item) => item.id === id);
      if (row?.status === "failed") return execute([row]);
    },
    clear: (collectionId: string) => {
      dispatch({ type: "clear", collectionId });
      setDismissed(
        (previous) =>
          new Set([
            ...previous,
            ...(jobs.data ?? [])
              .filter(
                (job) =>
                  job.collection_id === collectionId && !activeIngestion(job),
              )
              .map((job) => job.id),
          ]),
      );
      setBatchError("");
    },
  };
}

export type UploadQueue = ReturnType<typeof useUploadQueue>;
