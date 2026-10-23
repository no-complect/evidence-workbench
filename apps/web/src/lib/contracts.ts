import type {
  Plan,
  Report,
  Limits,
} from "../../../../packages/contracts/models";
export type { Plan, Report, Limits };
export type Project = { id: string; name: string };
export type Collection = {
  id: string;
  name: string;
  document_count: number;
  embedding_config: string;
  read_only?: boolean;
  setup_status?: "preparing" | "ready" | "failed";
  setup_error?: string | null;
  setup_request?: Omit<
    import("../../../../packages/contracts/models").CollectionSetup,
    "idempotency_key"
  > | null;
};
export type Run = {
  id: string;
  collection_id?: string;
  question: string;
  status: string;
  mode: string;
  strategy: string;
  plan: Plan | null;
  report: Report | null;
  error: string | null;
  created_at: string;
  tokens_used: number;
  tools_used: number;
  cost_used: string | number;
  request: { limits: Limits };
  harness_snapshot?:
    import("@/features/harness/contracts").HarnessSnapshot | null;
  cancel_requested: boolean;
};
export type Evidence = {
  id: string;
  chunk_id: string;
  text: string;
  source_name: string;
  version_id: string;
  page: number | null;
  section: string;
  start_offset: number;
  end_offset: number;
  scores: { rrf?: number; ranks?: Record<string, number>; reranker: string };
  metadata: {
    synthetic?: boolean;
    stale?: boolean;
    topics?: string[];
    reviewed_at?: string;
    untrusted_instructions?: boolean;
    source_url?: string;
  };
};
export type RunEvent = {
  id: number;
  stage: string;
  message: string;
  created_at: string;
  data: Record<string, unknown>;
};
export type Context = {
  id: string;
  stage: string;
  call_key: string;
  payload: {
    policy_version: string;
    prompt_id: string;
    prompt_hash: string;
    input_tokens_estimate: number;
    token_estimator: string;
    selected: { evidence_id: string; reason: string }[];
    excluded: { evidence_id: string; reason: string }[];
    assembled_input: unknown;
    output_token_reservation: number;
  };
};
export type Detail = {
  run: Run;
  evidence: Evidence[];
  contexts: Context[];
  tasks: {
    id: string;
    iteration: number;
    question: string;
    evidence_ids: string[];
  }[];
};
export type Source = {
  id: string;
  name: string;
  status: string;
  error: string | null;
  chunk_count: number;
  version_count: number;
  vector_chunk_count?: number;
  current_version_id?: string | null;
};
export type Evaluation = {
  id: string;
  mode: string;
  created_at: string;
  versions: Record<string, unknown>;
  raw?: EvaluationCase[];
  results: {
    strategy: string;
    cases: number;
    recall_at_k: number | null;
    mrr: number | null;
    citation_validity: number;
    quote_support: number | null;
    completion_rate: number;
    mean_tokens: number;
    mean_latency_seconds: number;
    estimated_cost_usd: number | null;
  }[];
};

export type EvaluationCase = {
  case: string;
  question?: string;
  expected_sources?: string[];
  expected_disclosure?: string;
  expect_no_evidence?: boolean;
  split: string;
  strategy: string;
  run_id: string;
  status: string;
  checks: Record<string, boolean>;
  ranked_sources: string[];
  latency_seconds: number;
  recall_at_k?: number | null;
  mrr?: number | null;
  citation_validity?: number | null;
  quote_support?: number | null;
  tokens?: number;
  estimated_cost_usd?: number | null;
  judging?: CaseJudging;
};
export type SemanticGrade = {
  id: string;
  run_id: string;
  claim_index: number;
  status: "reserved" | "graded" | "ungraded";
  request: {
    model_id: string;
    claim_preview: string;
    evidence_ids: string[];
    source_version_ids: string[];
    input_sha256: string;
    prompt_sha256: string;
    schema_sha256: string;
    context_policy: string;
  };
  result: {
    label?: "supported" | "contradicted" | "insufficient";
    reason?: string;
    estimated_cost_usd?: number | null;
    cost_source?: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    } | null;
  };
  tokens_charged: number;
  token_bound: number;
};
export type CaseJudging = {
  model_id: string;
  claims: number;
  sampled: number;
  unsampled: number;
  graded: number;
  ungraded: number;
  semantic_support: number | null;
  judgments: SemanticGrade[];
};
export type EvaluationJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  request: { split: string; custom?: Record<string, unknown> | null };
  progress: {
    completed?: number;
    total?: number;
    strategy?: string;
    case?: string;
    stage?: string;
    judged_runs?: number;
  };
  result_id: string | null;
  cancel_requested: boolean;
  error: string | null;
  created_at: string;
};

export type Bootstrap = {
  projects: Project[];
  examples: string[];
  live_enabled: boolean;
  evaluations_enabled: boolean;
  model_catalog_enabled?: boolean;
  auth_mode: "demo" | "supabase";
};
export type RunListItem = Pick<
  Run,
  "id" | "question" | "status" | "mode" | "strategy" | "created_at"
>;
export type ProjectData = { collections: Collection[]; runs: RunListItem[] };
export type EvaluationSplit = "development" | "held-out" | "all";
export type EvaluationSnapshot = {
  evaluations: Evaluation[];
  jobs: EvaluationJob[];
};
export type RunSnapshot = {
  detail: Detail;
  events: RunEvent[];
  cursor: number;
  hasMoreEvents: boolean;
};

export type CollectionOptions = {
  documents: { name: string; bytes: number }[];
  live_embeddings: boolean;
};
export type UploadResult = {
  document_id: string;
  version_id: string;
  status: "ready";
  deduplicated: boolean;
  chunks?: number;
  vector_chunks?: number;
};
export type SearchHit = {
  rrf: number;
  ranks: { full_text?: number; vector?: number };
  reranker: string;
  chunk: {
    id: string;
    text: string;
    source_name: string;
    version_id: string;
    content_hash: string;
    section: string;
    page: number | null;
    start_offset: number;
    end_offset: number;
    embedding_config: string;
    metadata: Evidence["metadata"];
  };
};
