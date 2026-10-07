// Generated from Pydantic by scripts/check-contracts.py --write. Do not edit.
export type Limits = { iterations: number; tool_calls: number; tokens: number; wall_seconds: number; concurrency: number; estimated_cost_usd: number; top_k: number };
export type Task = { id: string; topic: string; question: string };
export type Plan = { tasks: Task[]; rationale: string };
export type Claim = { text: string; evidence_ids: string[]; support: "direct_quote" | "model_assessed" };
export type Report = { title: string; summary: string; claims: Claim[]; limitations: string[]; recommendations: string[]; partial: boolean };
export type RunCreate = { collection_id: string; question: string; mode: "demo" | "live"; strategy: "rag" | "workflow" | "agent"; approve_plan: boolean; web_enabled: boolean; limits: Limits; idempotency_key: string };
