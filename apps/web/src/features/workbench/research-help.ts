import type { Limits } from "../../../../../packages/contracts/models";

export const limitHelp: Record<keyof Limits, string> = {
  iterations:
    "Maximum follow-up research cycles for bounded research. Fixed workflow and Basic RAG do not become iterative when this limit is raised.",
  tool_calls:
    "Bounds research tool invocations for the run. Hitting the limit can leave explicit evidence gaps or a partial report.",
  concurrency:
    "Maximum research tasks allowed to gather evidence concurrently. Increasing this does not expand the total token or tool budget.",
  top_k:
    "Maximum ranked passages requested per retrieval search. More passages consume more context; retrieval rank is not factual confidence.",
  tokens:
    "Token budget enforced through reservations and recorded usage. Input estimates and output reservations count toward this bound; it is not a guarantee of final provider billing.",
  wall_seconds:
    "Execution time limit checked by the worker. An in-flight call may finish while the run is stopping; saved evidence and checkpoints remain available.",
  estimated_cost_usd:
    "Estimated dollar cap using configured operator rates. If rates are unknown, dollar estimates and this cap are unavailable; other resource limits still apply.",
};
