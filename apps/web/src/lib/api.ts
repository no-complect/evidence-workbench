import { supabase } from "./supabase";
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
};
export type Run = {
  id: string;
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
};
export type Evaluation = {
  id: string;
  mode: string;
  created_at: string;
  versions: Record<string, unknown>;
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
    estimated_cost_usd: number;
  }[];
};
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const client = supabase();
  if (client) {
    const { data } = await client.auth.getSession();
    if (data.session)
      headers.set("Authorization", `Bearer ${data.session.access_token}`);
  }
  const response = await fetch(`/api/backend/${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(
      typeof error?.detail === "string"
        ? error.detail
        : `Request failed (${response.status})`,
    );
  }
  return response.json();
}
export async function exportReport(path: string) {
  const client = supabase();
  const headers: Record<string, string> = {};
  if (client) {
    const { data } = await client.auth.getSession();
    if (data.session)
      headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  const response = await fetch(`/api/backend/${path}`, { headers });
  if (!response.ok) throw new Error("Export failed");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = "research-report.md";
  link.click();
  URL.revokeObjectURL(url);
}
