export const metricHelp = {
  "Recall@5":
    "Fraction of expected supporting sources found in the top five retrieval results. A relevant source is not proof that the generated answer is correct.",
  MRR: "Mean reciprocal rank of the first expected supporting source: rank 1 scores 1, rank 2 scores 0.5. Missing support scores 0; an unavailable measurement is shown as a dash.",
  "Valid citations":
    "Share of citations that resolve to evidence authorized for that run. A resolvable citation can still fail to support the claim.",
  "Quote support*":
    "Exact substring checks for direct quotations in their cited passages. This does not grade the meaning of a synthesized claim.",
  Completed:
    "Share of investigations that completed for this strategy. Completion is an execution outcome, not a passing quality score.",
  Latency:
    "Mean recorded runtime of a case for this strategy. Faster execution does not imply better evidence or a more accurate answer.",
} as const;
