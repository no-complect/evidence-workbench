import type { EvaluationCaseInput } from "../../../../../packages/contracts/models";

export const MAX_CASES = 6;
export const NO_EVIDENCE = "__none__";
export type CaseDraft = {
  id: number;
  question: string;
  expected: string;
  disclosure: string;
};
export type CaseDrafts = { nextId: number; cases: CaseDraft[] };
export type CaseAction =
  | { type: "add" }
  | { type: "remove"; id: number }
  | {
      type: "edit";
      id: number;
      field: "question" | "expected" | "disclosure";
      value: string;
    }
  | { type: "mode" }
  | { type: "collection" };
const emptyCase = (id: number): CaseDraft => ({
  id,
  question: "",
  expected: "",
  disclosure: "",
});
export const initialCaseDrafts: CaseDrafts = {
  nextId: 2,
  cases: [emptyCase(1)],
};

export function caseReducer(state: CaseDrafts, action: CaseAction): CaseDrafts {
  switch (action.type) {
    case "add":
      return state.cases.length >= MAX_CASES
        ? state
        : {
            nextId: state.nextId + 1,
            cases: [...state.cases, emptyCase(state.nextId)],
          };
    case "remove":
      return state.cases.length === 1
        ? state
        : { ...state, cases: state.cases.filter((c) => c.id !== action.id) };
    case "edit":
      return {
        ...state,
        cases: state.cases.map((c) =>
          c.id === action.id ? { ...c, [action.field]: action.value } : c,
        ),
      };
    case "mode":
      return {
        ...state,
        cases: state.cases.map((c) => ({ ...c, question: "" })),
      };
    case "collection":
      return {
        ...state,
        cases: state.cases.map((c) => ({ ...c, expected: "" })),
      };
  }
}

export function compileCases(
  state: CaseDrafts,
  sources: string[],
  examples: string[],
  mode: "demo" | "live",
): EvaluationCaseInput[] {
  return state.cases.map((c, i) => {
    const question = (
      c.question || (mode === "demo" ? (examples[1] ?? examples[0] ?? "") : "")
    ).trim();
    if (question.length < 10 || question.length > 4000)
      throw new Error(
        `Case ${i + 1}: enter a question of 10–4,000 characters.`,
      );
    if (mode === "demo" && !examples.includes(question))
      throw new Error(
        `Case ${i + 1}: choose a seeded question for scripted execution.`,
      );
    if (c.expected !== NO_EVIDENCE && !sources.includes(c.expected))
      throw new Error(
        `Case ${i + 1}: choose a current source or explicitly expect no supporting evidence.`,
      );
    return {
      question,
      query: question.slice(0, 1000),
      expected_sources: c.expected === NO_EVIDENCE ? [] : [c.expected],
      expect_no_evidence: c.expected === NO_EVIDENCE,
      expected_disclosure: c.disclosure.trim(),
    };
  });
}
