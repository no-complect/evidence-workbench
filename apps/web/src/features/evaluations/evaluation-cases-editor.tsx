import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Source } from "@/lib/contracts";
import {
  MAX_CASES,
  NO_EVIDENCE,
  type CaseAction,
  type CaseDrafts,
} from "./case-state";
import styles from "@/features/harness/studio.module.css";
import cases from "./evaluation-results.module.css";

export function EvaluationCasesEditor({
  state,
  onChange,
  sources,
  examples,
  mode,
}: {
  state: CaseDrafts;
  onChange: (action: CaseAction) => void;
  sources: Source[];
  examples: string[];
  mode: "demo" | "live";
}) {
  return (
    <div className={cases.editor}>
      <div className={cases.suiteHeading}>
        <strong>Test cases</strong>
        <span>
          {state.cases.length} / {MAX_CASES}
        </span>
      </div>
      {state.cases.map((c, i) => {
        const suffix = i ? ` ${i + 1}` : "";
        const question =
          c.question ||
          (mode === "demo" ? (examples[1] ?? examples[0] ?? "") : "");
        const expected =
          c.expected === NO_EVIDENCE ||
          sources.some((s) => s.name === c.expected)
            ? c.expected
            : "";
        const edit = (
          field: "question" | "expected" | "disclosure",
          value: string,
        ) => onChange({ type: "edit", id: c.id, field, value });
        return (
          <fieldset className={cases.caseEditor} key={c.id}>
            <legend>Case {i + 1}</legend>
            <div className={cases.caseTools}>
              <span>Question and expected evidence</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={state.cases.length === 1}
                aria-label={`Remove case ${i + 1}`}
                onClick={() => onChange({ type: "remove", id: c.id })}
              >
                <Trash2 size={13} />
                Remove
              </Button>
            </div>
            <label className={styles.field}>
              Test question
              {mode === "demo" ? (
                <select
                  aria-label={`Test question${suffix}`}
                  value={question}
                  onChange={(e) => edit("question", e.target.value)}
                >
                  {examples.map((q) => (
                    <option key={q}>{q}</option>
                  ))}
                </select>
              ) : (
                <textarea
                  aria-label={`Test question${suffix}`}
                  value={question}
                  maxLength={4000}
                  rows={3}
                  onChange={(e) => edit("question", e.target.value)}
                />
              )}
            </label>
            <label className={styles.field}>
              Expected supporting source
              <select
                aria-label={`Expected supporting source${suffix}`}
                value={expected}
                onChange={(e) => edit("expected", e.target.value)}
              >
                <option value="">Choose a source</option>
                <option value={NO_EVIDENCE}>
                  No supporting evidence expected
                </option>
                {sources.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              Expected disclosure text · optional
              <input
                aria-label={`Expected disclosure text${suffix}`}
                value={c.disclosure}
                maxLength={200}
                placeholder="A phrase that should appear when evidence is missing"
                onChange={(e) => edit("disclosure", e.target.value)}
              />
            </label>
          </fieldset>
        );
      })}
      <Button
        type="button"
        variant="secondary"
        disabled={state.cases.length >= MAX_CASES}
        onClick={() => onChange({ type: "add" })}
      >
        <Plus size={14} />
        Add test case
      </Button>
      <p className="fine-print">
        Each case runs through three strategies: {state.cases.length * 3}{" "}
        investigations total. Add evidence-gap cases to test abstention and
        disclosure.
      </p>
    </div>
  );
}
