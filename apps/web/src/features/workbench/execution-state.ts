import type { RunEvent, Context } from "@/lib/contracts";

export const executionNodes = [
  {
    id: "plan",
    label: "Plan & approve",
    subtitle: "Typed plan · human checkpoint",
    stages: ["plan", "approve"],
    component: "Plan schema · LangGraph interrupt",
    boundary: "Question + trusted instruction + approval",
    output: "Reviewed research tasks",
    description:
      "The planner proposes bounded research tasks. Human approval is a persisted checkpoint when enabled.",
  },
  {
    id: "gather",
    label: "Gather evidence",
    subtitle: "LangChain retriever",
    stages: ["dispatch", "gather"],
    component: "PostgresHybridRetriever · LangGraph Send",
    boundary: "Project + collection + pinned source versions",
    output: "Evidence IDs and component ranks",
    description:
      "Independent tasks retrieve ranked passages. Their source versions remain attached to the run, and evidence identities merge without duplicating records.",
  },
  {
    id: "assess",
    label: "Assess & route",
    subtitle: "Evidence sufficiency · bounded follow-up",
    stages: ["assess"],
    component: "Assessment schema · conditional routing",
    boundary: "Retrieved passages + remaining execution limits",
    output: "Coverage, gaps, contradictions, follow-up tasks",
    description:
      "The reviewer identifies gaps and contradictions. Bounded research can gather again within the iteration limit; fixed workflow and basic RAG proceed to synthesis.",
  },
  {
    id: "report",
    label: "Write the brief",
    subtitle: "Typed report contract",
    stages: ["report"],
    component: "Report schema · structured model invocation",
    boundary: "Trusted instruction + untrusted evidence",
    output: "Evidence-linked claims and explicit limitations",
    description:
      "The writer produces a typed report. Every factual claim carries supporting evidence identities or remains an explicit limitation.",
  },
  {
    id: "verify",
    label: "Verify citations",
    subtitle: "Access & exact-quote checks",
    stages: ["verify", "finalize"],
    component: "Citation verifier · report persistence",
    boundary: "Run evidence + project authorization",
    output: "Saved report and terminal run state",
    description:
      "The verifier checks citation access and exact substrings for direct quotes. This is not an independent semantic assessment of synthesized claims.",
  },
] as const;

export function nodeRecords(
  id: string,
  events: RunEvent[],
  contexts: Context[],
) {
  const node = executionNodes.find((n) => n.id === id) ?? executionNodes[1];
  return {
    node,
    events: events.filter((e) =>
      (node.stages as readonly string[]).includes(e.stage),
    ),
    contexts: contexts.filter((c) =>
      (node.stages as readonly string[]).includes(c.stage),
    ),
  };
}
