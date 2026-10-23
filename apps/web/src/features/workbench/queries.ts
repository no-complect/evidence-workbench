import {
  queryOptions,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";
import { workbenchApi } from "@/lib/workbench-api";
import type { EvaluationSnapshot, RunSnapshot } from "@/lib/contracts";

export const workspaceKeys = {
  bootstrap: ["workbench", "bootstrap"] as const,
  project: (project: string) => ["workbench", "project", project] as const,
  sources: (project: string, collection: string) =>
    [
      "workbench",
      "project",
      project,
      "collection",
      collection,
      "sources",
    ] as const,
  run: (project: string, run: string) =>
    ["workbench", "project", project, "run", run] as const,
  evaluations: (project: string) =>
    ["workbench", "project", project, "evaluations"] as const,
};

export const isTerminalRun = (status: string) =>
  ["completed", "partial", "failed", "cancelled"].includes(status);

export const bootstrapOptions = () =>
  queryOptions({
    queryKey: workspaceKeys.bootstrap,
    queryFn: ({ signal }) => workbenchApi.bootstrap(signal),
  });

export const projectOptions = (project: string) =>
  queryOptions({
    queryKey: workspaceKeys.project(project),
    queryFn: ({ signal }) => workbenchApi.project(project, signal),
    enabled: !!project,
    refetchInterval: (query) =>
      query.state.data?.collections.some(
        (collection) => collection.setup_status === "preparing",
      )
        ? 2500
        : false,
  });

export const sourceOptions = (project: string, collection: string) =>
  queryOptions({
    queryKey: workspaceKeys.sources(project, collection),
    queryFn: ({ signal }) => workbenchApi.sources(project, collection, signal),
    enabled: !!project && !!collection,
  });

export const runOptions = (client: QueryClient, project: string, run: string) =>
  queryOptions({
    queryKey: workspaceKeys.run(project, run),
    enabled: !!project && !!run,
    staleTime: 0,
    queryFn: async ({ signal }): Promise<RunSnapshot> => {
      const previous = client.getQueryData<RunSnapshot>(
        workspaceKeys.run(project, run),
      );
      const [detail, page] = await Promise.all([
        workbenchApi.run(project, run, signal),
        workbenchApi.events(project, run, previous?.cursor ?? 0, signal),
      ]);
      const events = new Map(
        previous?.events.map((event) => [event.id, event]),
      );
      page.events.forEach((event) => events.set(event.id, event));
      return {
        detail,
        events: [...events.values()].sort((a, b) => a.id - b.id),
        cursor: page.cursor,
        hasMoreEvents: page.events.length === 200,
      };
    },
    refetchInterval: (query) => {
      const snapshot = query.state.data;
      if (!snapshot || query.state.error) return 4_000;
      if (snapshot.hasMoreEvents) return 50;
      if (isTerminalRun(snapshot.detail.run.status)) return false;
      return snapshot.detail.run.status === "awaiting_approval" ? 2_500 : 1_100;
    },
  });

export function useResearchRun(project: string, run: string) {
  const client = useQueryClient();
  const query = useQuery(runOptions(client, project, run));
  const status = query.data?.detail.run.status;
  useEffect(() => {
    if (status && isTerminalRun(status)) {
      void client.invalidateQueries({
        queryKey: workspaceKeys.project(project),
        exact: true,
      });
    }
  }, [client, project, run, status]);
  return query;
}

export const evaluationOptions = (project: string) =>
  queryOptions({
    queryKey: workspaceKeys.evaluations(project),
    enabled: !!project,
    staleTime: 0,
    queryFn: async ({ signal }): Promise<EvaluationSnapshot> => {
      const [evaluations, jobs] = await Promise.all([
        workbenchApi.evaluations(project, signal),
        workbenchApi.evaluationJobs(project, signal),
      ]);
      return { evaluations, jobs };
    },
    refetchInterval: (query) =>
      query.state.data?.jobs.some(
        (job) => job.status === "queued" || job.status === "running",
      )
        ? 1_000
        : 5_000,
  });
