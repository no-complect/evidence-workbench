// Transport DTOs are generated from the Python request and response models.
export type * from "../../../../packages/contracts/models";
import type {
  Detail,
  RunEvent,
  Evaluation,
  EvaluationJob,
} from "../../../../packages/contracts/models";

// Query-cache projections belong to the client rather than the wire protocol.
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
