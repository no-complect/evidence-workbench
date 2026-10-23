import type { Limits } from "@/lib/contracts";

export const DEFAULT_QUESTION =
  "Compare three approaches to deploying an enterprise AI assistant. Investigate security, operating costs, retrieval quality, and maintenance. Support recommendations with evidence and identify unresolved questions.";
export type ExecutionMode = "demo" | "live";
export type ResearchStrategy = "agent" | "rag" | "workflow";
export const limitFields = [
  ["iterations", "Max iterations", 1, 5],
  ["tool_calls", "Tool calls", 1, 100],
  ["concurrency", "Researchers", 1, 3],
  ["top_k", "Results per search", 1, 20],
  ["tokens", "Token budget", 500, 200000],
  ["wall_seconds", "Execution seconds", 5, 900],
  ["estimated_cost_usd", "Estimated cost cap · USD", 0, 25],
] as const;

export type ResearchDraft = {
  question: string;
  mode: ExecutionMode;
  strategy: ResearchStrategy;
  limits: Record<keyof Limits, string>;
  approval: boolean;
  webEnabled: boolean;
};
export const initialResearchDraft: ResearchDraft = {
  question: DEFAULT_QUESTION,
  mode: "demo",
  strategy: "agent",
  approval: true,
  webEnabled: false,
  limits: {
    iterations: "2",
    tool_calls: "24",
    tokens: "48000",
    wall_seconds: "120",
    concurrency: "1",
    estimated_cost_usd: "1",
    top_k: "5",
  },
};
export type DraftAction =
  | { type: "question"; value: string }
  | { type: "mode"; value: ExecutionMode }
  | { type: "strategy"; value: ResearchStrategy }
  | { type: "approval"; value: boolean }
  | { type: "web"; value: boolean }
  | { type: "limits"; value: Limits }
  | { type: "limit"; key: keyof Limits; value: string };

export function researchReducer(
  state: ResearchDraft,
  action: DraftAction,
): ResearchDraft {
  switch (action.type) {
    case "question":
      return { ...state, question: action.value };
    case "mode":
      return {
        ...state,
        mode: action.value,
        webEnabled: action.value === "live" && state.webEnabled,
      };
    case "strategy":
      return { ...state, strategy: action.value };
    case "approval":
      return { ...state, approval: action.value };
    case "web":
      return { ...state, webEnabled: state.mode === "live" && action.value };
    case "limit":
      return {
        ...state,
        limits: { ...state.limits, [action.key]: action.value },
      };
    case "limits":
      return {
        ...state,
        limits: Object.fromEntries(
          Object.entries(action.value).map(([key, value]) => [
            key,
            String(value),
          ]),
        ) as ResearchDraft["limits"],
      };
  }
}

export function researchRequest(draft: ResearchDraft, collection: string) {
  if (!collection) throw new Error("Select a collection");
  if (draft.question.trim().length < 10)
    throw new Error("Enter a research question of at least 10 characters");
  const limits = parseLimits(draft.limits);
  return {
    harness_config: null as
      | import("../../../../../packages/contracts/models").HarnessConfiguration
      | null,
    harness_revision_id: null as string | null,
    model_id: null as string | null,
    question: draft.question,
    collection_id: collection,
    mode: draft.mode,
    strategy: draft.strategy,
    limits,
    approve_plan: draft.approval,
    web_enabled: draft.mode === "live" && draft.webEnabled,
  };
}

export type SubmissionIntent = { fingerprint: string; key: string };
export function submissionIntent(
  previous: SubmissionIntent | null,
  request: unknown,
  createKey: () => string,
): SubmissionIntent {
  const fingerprint = JSON.stringify(request);
  return previous?.fingerprint === fingerprint
    ? previous
    : { fingerprint, key: createKey() };
}

export function parseLimits(rawLimits: Record<keyof Limits, string>): Limits {
  const limits = {} as Limits;
  for (const [key, label, min, max] of limitFields) {
    const raw = rawLimits[key];
    const value = Number(raw);
    if (
      !raw.trim() ||
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (key !== "estimated_cost_usd" && !Number.isInteger(value))
    ) {
      throw new Error(
        `${label} must be ${key === "estimated_cost_usd" ? "a number" : "an integer"} between ${min} and ${max}`,
      );
    }
    limits[key] = value;
  }
  return limits;
}
