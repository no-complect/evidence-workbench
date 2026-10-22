import { api } from "@/lib/api";
import type {
  ModelVerification,
  HarnessCreate,
} from "../../../../../packages/contracts/models";
import type {
  HarnessState,
  Connection,
  Verification,
  Revision,
} from "./contracts";
const root = (project: string) => `projects/${project}/harness`;
const post = (body?: unknown): RequestInit => ({
  method: "POST",
  ...(body ? { body: JSON.stringify(body) } : {}),
});
export const harnessApi = {
  state: (project: string, signal?: AbortSignal) =>
    api<HarnessState>(root(project), { signal }),
  // Credentials travel directly to the server; never pass them through query/mutation caches.
  connect: (
    project: string,
    body: { name: string; use_environment: boolean; api_key?: string },
  ) => api<Connection>(`${root(project)}/connections`, post(body)),
  discover: (project: string, id: string) =>
    api<string[]>(`${root(project)}/connections/${id}/discover`, post()),
  disconnect: (project: string, id: string) =>
    api(`${root(project)}/connections/${id}/disconnect`, post()),
  verify: (project: string, id: string, body: ModelVerification) =>
    api<Verification>(`${root(project)}/connections/${id}/verify`, post(body)),
  save: (project: string, body: HarnessCreate) =>
    api<Revision>(`${root(project)}/revisions`, post(body)),
};
