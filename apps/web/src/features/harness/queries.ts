import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  HarnessCreate,
  ModelVerification,
} from "../../../../../packages/contracts/models";
import { harnessApi } from "./api";
import type { HarnessState } from "./contracts";
export const harnessKey = (project: string) =>
  ["workbench", "project", project, "harness"] as const;
export const harnessOptions = (project: string, enabled: boolean) =>
  queryOptions({
    queryKey: harnessKey(project),
    queryFn: ({ signal }) => harnessApi.state(project, signal),
    enabled: !!project && enabled,
    refetchInterval: (query) =>
      query.state.data?.checks.some((check) => check.status === "checking")
        ? 2500
        : false,
  });
export function useConnectionAction(
  project: string,
  id: string,
  kind: "discover" | "disconnect",
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => harnessApi[kind](project, id),
    retry: false,
    onSuccess: (result) => {
      if (kind === "discover" && Array.isArray(result)) {
        client.setQueryData<HarnessState>(harnessKey(project), (previous) =>
          previous
            ? {
                ...previous,
                connections: previous.connections.map((connection) =>
                  connection.id === id
                    ? {
                        ...connection,
                        catalog: result as string[],
                        catalog_discovery: null,
                        discovered_at: null,
                      }
                    : connection,
                ),
              }
            : previous,
        );
      }
    },
    onSettled: () =>
      client.invalidateQueries({ queryKey: harnessKey(project), exact: true }),
  });
}
export function useVerification(project: string, id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ModelVerification) =>
      harnessApi.verify(project, id, body),
    retry: false,
    onSettled: () =>
      client.invalidateQueries({ queryKey: harnessKey(project), exact: true }),
  });
}
export function useSaveHarness(project: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: HarnessCreate) => harnessApi.save(project, body),
    retry: false,
    onSettled: () =>
      client.invalidateQueries({ queryKey: harnessKey(project), exact: true }),
  });
}
