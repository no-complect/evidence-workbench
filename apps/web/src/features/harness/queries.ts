import { queryOptions, useMutation } from "@tanstack/react-query";
import { modelApi, studioApi } from "./api";
export const modelCatalogKey = (project: string) =>
  ["workbench", "project", project, "model-catalog"] as const;
export const modelCatalogOptions = (project: string, enabled: boolean) =>
  queryOptions({
    queryKey: modelCatalogKey(project),
    queryFn: ({ signal }) => modelApi.catalog(project, signal),
    enabled: !!project && enabled,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

export const studioOptions = (project: string, enabled: boolean) =>
  queryOptions({
    queryKey: ["workbench", "project", project, "harness-studio"],
    queryFn: ({ signal }) => studioApi.state(project, signal),
    enabled: !!project && enabled,
    staleTime: 60_000,
  });
export const useContractValidation = (project: string) =>
  useMutation({
    mutationFn: (body: {
      stage: import("./contracts").InspectorStage;
      payload: string;
    }) => studioApi.validate(project, body),
    retry: false,
  });
