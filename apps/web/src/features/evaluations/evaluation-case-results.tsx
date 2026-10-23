import { ArrowUpRight, CheckCircle2, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EvaluationCase } from "@/lib/contracts";
import styles from "./evaluation-results.module.css";
import { SemanticGrades } from "./semantic-grades";

const checkLabels: Record<string, string> = {
  abstained_without_claims: "Abstention · no claims when evidence is absent",
  disclosure: "Expected disclosure text appears",
  injection_resisted: "Known source instruction was not repeated as a claim",
};
const percent = (n: number | null | undefined) =>
  n == null ? "Not measured" : `${(100 * n).toFixed(0)}%`;

export function EvaluationCaseResults({
  rows,
  onOpenRun,
}: {
  rows: EvaluationCase[];
  onOpenRun: (runId: string) => void;
}) {
  const failedChecks = rows.reduce(
    (n, row) =>
      n + Object.values(row.checks).filter((passed) => !passed).length,
    0,
  );
  return (
    <>
      <p className={failedChecks ? styles.review : "fine-print"}>
        {failedChecks
          ? `${failedChecks} failed case checks. Open the investigation to inspect the report and supporting evidence.`
          : "Case checks and retrieval measurements are shown separately from execution status."}
      </p>
      <div className={styles.caseResults}>
        {rows.map((row) => (
          <article
            className={styles.result}
            key={`${row.strategy}/${row.case}`}
            aria-label={`${row.case} · ${row.strategy}`}
          >
            <div className={styles.caseHeading}>
              <div>
                <h3>
                  {row.case} · {row.strategy}
                </h3>
                <p>
                  Execution: {row.status} · {row.latency_seconds.toFixed(2)}s
                </p>
              </div>
              <Button
                help="Open the exact saved investigation for this case and strategy, including its report, citations, execution events and assembled context."
                variant="secondary"
                size="sm"
                aria-label={`Open case ${row.case} ${row.strategy}`}
                disabled={!row.run_id}
                onClick={() => onOpenRun(row.run_id)}
              >
                Open case <ArrowUpRight size={13} />
              </Button>
            </div>
            {row.question && <p className={styles.question}>{row.question}</p>}
            <dl className={styles.metrics}>
              <div>
                <dt>Retrieval Recall@5</dt>
                <dd>{percent(row.recall_at_k)}</dd>
              </div>
              <div>
                <dt>Valid citations</dt>
                <dd>{percent(row.citation_validity)}</dd>
              </div>
              <div>
                <dt>Quote substring support</dt>
                <dd>{percent(row.quote_support)}</dd>
              </div>
              <div>
                <dt>Tokens</dt>
                <dd>{row.tokens?.toLocaleString() ?? "Not recorded"}</dd>
              </div>
            </dl>
            {Object.entries(row.checks).map(([name, passed]) => (
              <div
                className={`${styles.check} ${passed ? styles.passed : styles.failed}`}
                key={name}
              >
                {passed ? (
                  <CheckCircle2 size={15} />
                ) : (
                  <CircleAlert size={15} />
                )}
                <span>
                  <strong>{passed ? "Passed" : "Failed"}</strong> ·{" "}
                  {checkLabels[name] ?? name}
                </span>
              </div>
            ))}
            {row.judging && (
              <SemanticGrades
                rows={row.judging.judgments}
                sample={row.judging}
              />
            )}
            <details>
              <summary>Inspect expectations and retrieved sources</summary>
              <div className={styles.expectations}>
                {(row.expected_sources || row.expect_no_evidence) && (
                  <p>
                    Expected evidence:{" "}
                    {row.expect_no_evidence
                      ? "No supporting evidence"
                      : row.expected_sources?.join(", ") || "None specified"}
                    .
                  </p>
                )}
                {row.expected_disclosure && (
                  <p>Expected disclosure: “{row.expected_disclosure}”</p>
                )}
                <p>
                  Retrieved sources:{" "}
                  {row.ranked_sources.join(", ") || "No retained passages"}.
                </p>
                <p>
                  Estimated cost:{" "}
                  {row.estimated_cost_usd == null
                    ? "Unavailable"
                    : `$${row.estimated_cost_usd.toFixed(4)}`}
                  . Retrieval and quote checks do not establish semantic
                  correctness.
                </p>
              </div>
            </details>
          </article>
        ))}
      </div>
    </>
  );
}
