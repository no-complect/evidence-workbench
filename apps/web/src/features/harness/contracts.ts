import type { Limits } from "@/lib/contracts";
export type Stage = "plan" | "assess" | "report";
export type InspectorStage = Stage | "judge";
export type JudgeSelection = {
  modelId: string;
  onChange: (id: string) => void;
};
export const stages: [Stage, string][] = [
  ["plan", "Planner"],
  ["assess", "Reviewer"],
  ["report", "Writer"],
];
export type ModelCatalog = {
  configured: boolean;
  models: string[];
  default_model: string;
  live_enabled: boolean;
  pricing_configured: boolean;
  judge_pricing_configured?: boolean;
  returned_count?: number;
  request_id?: string | null;
  providers?: {
    provider: "openai" | "anthropic";
    count: number;
    error: string | null;
  }[];
  embeddings_configured?: boolean;
};
export type ModelTarget = {
  model_id: string;
  provider: string;
  connection_id?: string;
  connection_name?: string;
  verification_id?: string;
  adapter?: string;
  input_usd_per_million: number | null;
  output_usd_per_million: number | null;
};
export type HarnessSnapshot = {
  credential_source?: "environment";
  cost_estimates_available?: boolean;
  name?: string;
  revision_id?: string;
  targets: Record<Stage, ModelTarget>;
  limits: Limits;
  fingerprints: {
    adapter: string;
    context_policy: string;
    output_token_cap: number;
    prompts: Record<Stage, string>;
    contracts: Record<Stage, string>;
    tool_policy: string;
  };
};

export type HarnessStudioState = {
  schemas: Record<InspectorStage, Record<string, unknown>>;
  prompts: Record<InspectorStage, string>;
  context_caps: Record<Stage, number>;
  context_policy: string;
};
