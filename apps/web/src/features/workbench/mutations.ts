import { useMutation, useQueryClient } from "@tanstack/react-query";
import { workbenchApi } from "@/lib/workbench-api";
import type { Bootstrap, Plan } from "@/lib/contracts";
import type { RunCreate } from "../../../../../packages/contracts/models";
import { workspaceKeys } from "./queries";

export function useCreateProject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: workbenchApi.createProject,
    onSuccess: (project) =>
      client.setQueryData<Bootstrap>(workspaceKeys.bootstrap, (previous) =>
        previous
          ? {
              ...previous,
              projects: [
                ...previous.projects.filter((p) => p.id !== project.id),
                project,
              ],
            }
          : previous,
      ),
  });
}

export function useCreateCollection(project: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; embedding_config: string }) =>
      workbenchApi.createCollection(project, body),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: workspaceKeys.project(project),
        exact: true,
      }),
  });
}

export function useUploadSource(project: string, collection: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => workbenchApi.upload(project, collection, file),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({
          queryKey: workspaceKeys.sources(project, collection),
        }),
        client.invalidateQueries({
          queryKey: workspaceKeys.project(project),
          exact: true,
        }),
      ]);
    },
  });
}

export function useStartResearch(project: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: RunCreate) => workbenchApi.start(project, request),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: workspaceKeys.project(project),
        exact: true,
      }),
  });
}

export function useApprovePlan(project: string, run: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (plan: Plan) => workbenchApi.approve(project, run, plan),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: workspaceKeys.run(project, run),
        exact: true,
      }),
  });
}

export function useCancelResearch(project: string, run: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => workbenchApi.cancel(project, run),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: workspaceKeys.run(project, run),
        exact: true,
      }),
  });
}
