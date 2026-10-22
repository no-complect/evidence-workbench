import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  CollectionSetup,
  SearchRequest,
} from "../../../../../packages/contracts/models";
import type { ProjectData, Collection } from "@/lib/contracts";
import { workbenchApi } from "@/lib/workbench-api";
import { workspaceKeys } from "@/features/workbench/queries";

export const collectionOptions = (project: string) =>
  queryOptions({
    queryKey: ["workbench", "project", project, "collection-options"],
    queryFn: ({ signal }) => workbenchApi.collectionOptions(project, signal),
    enabled: !!project,
    staleTime: 60_000,
  });
export function usePrepareCollection(project: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: CollectionSetup) =>
      workbenchApi.prepareCollection(project, request),
    onSuccess: (collection) =>
      client.setQueryData<ProjectData>(
        workspaceKeys.project(project),
        (previous) =>
          previous
            ? {
                ...previous,
                collections: [
                  ...previous.collections.filter(
                    (item) => item.id !== collection.id,
                  ),
                  collection,
                ],
              }
            : previous,
      ),
    onSettled: () =>
      client.invalidateQueries({
        queryKey: workspaceKeys.project(project),
        exact: true,
      }),
  });
}
export function useResumeCollection(project: string, collection: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => workbenchApi.resumeCollection(project, collection),
    onSuccess: async (_data: Collection) => {
      await Promise.all([
        client.invalidateQueries({
          queryKey: workspaceKeys.project(project),
          exact: true,
        }),
        client.invalidateQueries({
          queryKey: workspaceKeys.sources(project, collection),
          exact: true,
        }),
      ]);
    },
  });
}
export const retrievalOptions = (
  project: string,
  request: SearchRequest | null,
) =>
  queryOptions({
    queryKey: ["workbench", "project", project, "retrieval", request],
    queryFn: ({ signal }) => {
      if (!request) throw new Error("Enter a search question first");
      return workbenchApi.search(project, request, signal);
    },
    enabled: !!project && !!request,
    staleTime: Infinity,
    retry: false,
    retryOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });
