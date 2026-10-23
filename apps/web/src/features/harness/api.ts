import { api } from "@/lib/api";
import type {
  ModelCatalog,
  HarnessStudioState,
  InspectorStage,
} from "./contracts";
export const modelApi = {
  catalog: (project: string, signal?: AbortSignal) =>
    api<ModelCatalog>(`projects/${project}/harness/models`, { signal }),
};

export const studioApi = {
  state: (project: string, signal?: AbortSignal) =>
    api<HarnessStudioState>(`projects/${project}/harness/studio`, { signal }),
  validate: (
    project: string,
    body: { stage: InspectorStage; payload: string },
  ) =>
    api<{ valid: boolean; errors: { path: string; type: string }[] }>(
      `projects/${project}/harness/validate-contract`,
      { method: "POST", body: JSON.stringify(body) },
    ),
};
