import type { JudgeConfiguration } from "../../../../../packages/contracts/models";

export type JudgeDraft = Record<
  keyof Omit<JudgeConfiguration, "model_id">,
  string
>;

export const initialJudgeDraft: JudgeDraft = {
  max_claims_per_run: "2",
  tokens: "6000",
  wall_seconds: "120",
  estimated_cost_usd: "0.25",
};

export const judgeBudgetFields = [
  ["tokens", "Judge token budget", 1000, 200000],
  ["wall_seconds", "Judge grading seconds", 5, 300],
  ["estimated_cost_usd", "Judge estimated cost cap · USD", 0, 25],
] as const;

export function parseJudgeDraft(
  draft: JudgeDraft,
  modelId: string,
  pricesKnown: boolean,
): JudgeConfiguration {
  if (!modelId) throw new Error("Select an evaluation judge in Harness.");
  const result = { model_id: modelId } as JudgeConfiguration;
  const fields = [
    ["max_claims_per_run", "Claims sampled per investigation", 1, 5],
    ...judgeBudgetFields,
  ] as const;
  for (const [key, label, min, max] of fields) {
    // A hidden, previously edited cost field must not block an unpriced model.
    const raw =
      key === "estimated_cost_usd" && !pricesKnown
        ? initialJudgeDraft.estimated_cost_usd
        : draft[key];
    const value = Number(raw);
    if (
      !raw.trim() ||
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (key !== "estimated_cost_usd" && !Number.isInteger(value))
    ) {
      throw new Error(
        `${label} must be ${key === "estimated_cost_usd" ? "a number" : "an integer"} between ${min} and ${max}.`,
      );
    }
    result[key] = value;
  }
  return result;
}
