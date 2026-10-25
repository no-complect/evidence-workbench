import { api, exportReport } from "./api";
import type {
  Bootstrap,
  Project,
  ProjectData,
  Collection,
  Source,
  Detail,
  Run,
  RunEvent,
  Plan,
  Evaluation,
  EvaluationJob,
  EvaluationSplit,
  CollectionOptions,
  IngestionJob,
  EmbeddingUsage,
  SearchHit,
} from "./contracts";
import { sourceFileError } from "./ingestion";
import type {
  CollectionSetup,
  SearchRequest,
  RunCreate,
} from "../../../../packages/contracts/models";

const projectPath = (id: string) => `projects/${id}`;
const post = (body?: unknown): RequestInit => ({
  method: "POST",
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const workbenchApi = {
  bootstrap: (signal?: AbortSignal) => api<Bootstrap>("bootstrap", { signal }),
  project: (id: string, signal?: AbortSignal) =>
    api<ProjectData>(projectPath(id), { signal }),
  sources: (project: string, collection: string, signal?: AbortSignal) =>
    api<Source[]>(`${projectPath(project)}/collections/${collection}/sources`, {
      signal,
    }),
  run: (project: string, run: string, signal?: AbortSignal) =>
    api<Detail>(`${projectPath(project)}/runs/${run}`, { signal }),
  events: (
    project: string,
    run: string,
    cursor: number,
    signal?: AbortSignal,
  ) =>
    api<{ events: RunEvent[]; cursor: number }>(
      `${projectPath(project)}/runs/${run}/events?after=${cursor}`,
      { signal },
    ),
  createProject: (name: string) => api<Project>("projects", post({ name })),
  createCollection: (
    project: string,
    body: { name: string; embedding_config: string },
  ) =>
    api<Pick<Collection, "id" | "name" | "embedding_config">>(
      `${projectPath(project)}/collections`,
      post(body),
    ),
  collectionOptions: (project: string, signal?: AbortSignal) =>
    api<CollectionOptions>(`${projectPath(project)}/collection-options`, {
      signal,
    }),
  prepareCollection: (project: string, body: CollectionSetup) =>
    api<Collection>(`${projectPath(project)}/collection-setups`, post(body)),
  resumeCollection: (project: string, collection: string) =>
    api<Collection>(
      `${projectPath(project)}/collections/${collection}/prepare`,
      post(),
    ),
  search: (project: string, body: SearchRequest, signal?: AbortSignal) =>
    api<SearchHit[]>(`${projectPath(project)}/search`, {
      ...post(body),
      signal,
    }),
  ingestionJobs: (project: string, signal?: AbortSignal) =>
    api<IngestionJob[]>(`${projectPath(project)}/ingestions`, { signal }),
  embeddingUsage: (project: string, collection: string, signal?: AbortSignal) =>
    api<EmbeddingUsage>(
      `${projectPath(project)}/collections/${collection}/embedding-usage`,
      { signal },
    ),
  retryIngestion: (project: string, job: string) =>
    api<IngestionJob>(
      `${projectPath(project)}/ingestions/${job}/retry`,
      post(),
    ),
  cancelIngestion: (project: string, job: string) =>
    api<IngestionJob>(
      `${projectPath(project)}/ingestions/${job}/cancel`,
      post(),
    ),
  upload: (project: string, collection: string, file: File, key: string) => {
    const error = sourceFileError(file);
    if (error) throw new Error(error);
    const body = new FormData();
    body.append("file", file);
    body.append("idempotency_key", key);
    return api<IngestionJob>(
      `${projectPath(project)}/collections/${collection}/ingestions`,
      {
        method: "POST",
        body,
      },
    );
  },
  start: (project: string, request: RunCreate) =>
    api<Run>(`${projectPath(project)}/runs`, post(request)),
  approve: (project: string, run: string, plan: Plan) =>
    api(`${projectPath(project)}/runs/${run}/approve`, post(plan)),
  cancel: (project: string, run: string) =>
    api(`${projectPath(project)}/runs/${run}/cancel`, post()),
  export: (project: string, run: string) =>
    exportReport(`${projectPath(project)}/runs/${run}/report.md`),
  evaluations: (project: string, signal?: AbortSignal) =>
    api<Evaluation[]>(`${projectPath(project)}/evaluations`, { signal }),
  evaluationJobs: (project: string, signal?: AbortSignal) =>
    api<EvaluationJob[]>(`${projectPath(project)}/evaluation-jobs`, { signal }),
  evaluationJudgments: (project: string, job: string, signal?: AbortSignal) =>
    api<import("./contracts").SemanticGrade[]>(
      `${projectPath(project)}/evaluation-jobs/${job}/judgments`,
      { signal },
    ),
  startEvaluation: (
    project: string,
    split: EvaluationSplit,
    key: string,
    custom?: import("../../../../packages/contracts/models").CustomEvaluation,
  ) =>
    api<EvaluationJob>(
      `${projectPath(project)}/evaluation-jobs`,
      post({ split, idempotency_key: key, ...(custom ? { custom } : {}) }),
    ),
  cancelEvaluation: (project: string, job: string) =>
    api(`${projectPath(project)}/evaluation-jobs/${job}/cancel`, post()),
};
