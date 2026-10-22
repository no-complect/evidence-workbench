import { queryOptions } from "@tanstack/react-query";
import { modelApi } from "./api";
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
