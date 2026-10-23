import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { workbenchApi } from "@/lib/workbench-api";
import { workspaceKeys } from "@/features/workbench/queries";

export const judgmentOptions = (project: string, job: string) =>
  queryOptions({
    queryKey: [...workspaceKeys.evaluations(project), "job", job, "judgments"],
    queryFn: ({ signal }) =>
      workbenchApi.evaluationJudgments(project, job, signal),
  });

export function useSavedJudgments(
  project: string,
  job: string,
  enabled: boolean,
  running: boolean,
) {
  const client = useQueryClient();
  const query = useQuery({
    ...judgmentOptions(project, job),
    enabled,
    refetchInterval: enabled && running ? 2500 : false,
  });
  useEffect(() => {
    if (enabled && !running)
      void client.invalidateQueries({
        queryKey: judgmentOptions(project, job).queryKey,
      });
  }, [client, project, job, enabled, running]);
  return query;
}
