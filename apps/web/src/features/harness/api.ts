import { api } from "@/lib/api";
import type { ModelCatalog } from "./contracts";
export const modelApi = {
  catalog: (project: string, signal?: AbortSignal) =>
    api<ModelCatalog>(`projects/${project}/harness/models`, { signal }),
};
