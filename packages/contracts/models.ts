// Generated from Pydantic by scripts/check-contracts.py --write. Do not edit.
export type Limits = { iterations: number; tool_calls: number; tokens: number; wall_seconds: number; concurrency: number; estimated_cost_usd: number; top_k: number };
export type Task = { id: string; topic: string; question: string };
export type Plan = { tasks: Task[]; rationale: string };
export type Claim = { text: string; evidence_ids: string[]; support: "direct_quote" | "model_assessed" };
export type Report = { title: string; summary: string; claims: Claim[]; limitations: string[]; recommendations: string[]; partial: boolean };
export type RunCreate = { collection_id: string; question: string; mode: "demo" | "live"; strategy: "rag" | "workflow" | "agent"; approve_plan: boolean; web_enabled: boolean; limits: Limits; idempotency_key: string; harness_revision_id: string | null; model_id: string | null };
export type CollectionSetup = { name: string; embedding_config: "demo-v1" | "openai-small-v1"; purpose: string; source_kind: "starter" | "upload"; idempotency_key: string };
export type SearchRequest = { collection_id: string; query: string; top_k: number; method: "keyword" | "vector" | "hybrid" };
export type ModelVerification = { model_id: string; input_usd_per_million: number; output_usd_per_million: number; max_cost_usd: number; idempotency_key: string };
export type HarnessTargets = { plan: string; assess: string; report: string };
export type HarnessCreate = { name: string; targets: HarnessTargets; limits: Limits; idempotency_key: string };
