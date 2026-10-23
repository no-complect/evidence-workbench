"use client";

import type { CustomEvaluation } from "../../../../../packages/contracts/models";
import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { workbenchApi } from "@/lib/workbench-api";
import type { EvaluationSnapshot, EvaluationSplit } from "@/lib/contracts";
import { evaluationOptions, workspaceKeys } from "@/features/workbench/queries";
import {
  submissionIntent,
  type SubmissionIntent,
} from "@/features/workbench/research-state";

export function useEvaluations(projectId: string, active = true) {
  const client = useQueryClient();
  const query = useQuery({
    ...evaluationOptions(projectId),
    enabled: active && !!projectId,
  });
  const intent = useRef<SubmissionIntent | null>(null);
  const start = useMutation({
    mutationFn: ({
      split,
      key,
      custom,
    }: {
      split: EvaluationSplit;
      key: string;
      custom?: CustomEvaluation;
    }) => workbenchApi.startEvaluation(projectId, split, key, custom),
    onSuccess: async (job) => {
      client.setQueryData<EvaluationSnapshot>(
        workspaceKeys.evaluations(projectId),
        (previous) =>
          previous
            ? {
                ...previous,
                jobs: [
                  job,
                  ...previous.jobs.filter((item) => item.id !== job.id),
                ],
              }
            : { evaluations: [], jobs: [job] },
      );
      await client.invalidateQueries({
        queryKey: workspaceKeys.evaluations(projectId),
      });
    },
  });
  const cancel = useMutation({
    mutationFn: (jobId: string) =>
      workbenchApi.cancelEvaluation(projectId, jobId),
    onSuccess: async (_result, jobId) => {
      client.setQueryData<EvaluationSnapshot>(
        workspaceKeys.evaluations(projectId),
        (previous) =>
          previous
            ? {
                ...previous,
                jobs: previous.jobs.map((job) =>
                  job.id === jobId ? { ...job, cancel_requested: true } : job,
                ),
              }
            : previous,
      );
      await client.invalidateQueries({
        queryKey: workspaceKeys.evaluations(projectId),
      });
    },
  });
  function submit(split: EvaluationSplit, custom?: CustomEvaluation) {
    if (start.isPending) return;
    intent.current = submissionIntent(
      intent.current,
      { projectId, split, custom: custom ?? null },
      () => crypto.randomUUID(),
    );
    start.mutate(
      { split, key: intent.current.key, ...(custom ? { custom } : {}) },
      {
        onSuccess: () => {
          intent.current = null;
        },
      },
    );
  }
  return { query, start, cancel, submit };
}
