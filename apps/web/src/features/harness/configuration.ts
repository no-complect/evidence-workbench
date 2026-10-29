import type { HarnessConfiguration } from "../../../../../packages/contracts/models";

export const initialHarnessConfiguration: HarnessConfiguration = {
  system_instruction:
    "Use the supplied evidence. Cite supporting passages. Preserve uncertainty when evidence is missing or contradictory.",
  context_policy: "balanced",
  stage_models: { plan: null, assess: null, report: null },
};
