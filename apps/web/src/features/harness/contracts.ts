export type {
  ModelCatalog,
  ModelTarget,
  HarnessSnapshot,
  HarnessStudioState,
} from "../../../../../packages/contracts/models";
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
