"use client";
import { useReducer, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { workbenchApi } from "@/lib/workbench-api";
import { MAX_BATCH_FILES, sourceFileError } from "@/lib/ingestion";
import { workspaceKeys } from "@/features/workbench/queries";
import { uploadReducer, type UploadRow } from "./upload-state";

// Project-owned file intent survives switching collections/workspaces; records stay in queries.
export function useUploadQueue(projectId: string) {
  const [rows, dispatch] = useReducer(uploadReducer, []);
  const [busy, setBusy] = useState(false);
  const [batchError, setBatchError] = useState("");
  const locked = useRef(false);
  const client = useQueryClient();
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
          const result = await workbenchApi.upload(
            projectId,
            row.collectionId,
            row.file,
          );
          dispatch({
            type: "update",
            id: row.id,
            patch: { status: "ready", result },
          });
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
    busy,
    batchError,
    add,
    retry: (id: string) => {
      const row = rows.find((item) => item.id === id);
      if (row?.status === "failed") return execute([row]);
    },
    clear: (collectionId: string) => {
      dispatch({ type: "clear", collectionId });
      setBatchError("");
    },
  };
}
export type UploadQueue = ReturnType<typeof useUploadQueue>;
