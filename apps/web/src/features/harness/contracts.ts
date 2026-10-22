import type { Limits } from "@/lib/contracts";
export type Stage = "plan" | "assess" | "report";
export const stages: [Stage, string][] = [
  ["plan", "Planner"],
  ["assess", "Reviewer"],
  ["report", "Writer"],
];
export type Connection = {
  id: string;
  name: string;
  provider: "openai";
  active: boolean;
  catalog: string[];
  discovered_at: string | null;
  catalog_discovery?: {
    endpoint: string;
    returned_count: number;
    unique_count: number;
    request_id: string | null;
  } | null;
};
export type Verification = {
  id: string;
  connection_id: string;
  status: "checking" | "verified" | "failed" | "uncertain";
  error: string | null;
  estimated_cost: string | number;
  actual_cost: string | number | null;
  request: {
    model_id: string;
    input_usd_per_million: number;
    output_usd_per_million: number;
  };
};
export type ModelTarget = {
  model_id: string;
  provider: string;
  connection_id: string;
  connection_name: string;
  verification_id: string;
  input_usd_per_million: number;
  output_usd_per_million: number;
};
export type HarnessSnapshot = {
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
export type Revision = {
  id: string;
  name: string;
  snapshot: HarnessSnapshot;
  created_at: string;
};
export type HarnessState = {
  server_key_available: boolean;
  live_enabled: boolean;
  connections: Connection[];
  checks: Verification[];
  revisions: Revision[];
};
