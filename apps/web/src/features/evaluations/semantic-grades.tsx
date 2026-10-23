import type { SemanticGrade, CaseJudging } from "@/lib/contracts";
import styles from "./evaluation-results.module.css";

export function SemanticGrades({
  rows,
  sample,
}: {
  rows: SemanticGrade[];
  sample?: CaseJudging;
}) {
  return (
    <section className={styles.semantic} aria-label="Model judgments">
      <h4>Model judgments · sampled claims</h4>
      <p className="fine-print">
        {sample
          ? `${sample.graded} of ${sample.sampled} sampled claims graded; ${sample.unsampled} claims outside the sample.`
          : `${rows.filter((row) => row.status === "graded").length} saved grades across ${rows.length} claim records.`}{" "}
        Model grades are fallible and may share the writer’s biases. They are
        not independent ground truth.
      </p>
      {sample && sample.claims === 0 && (
        <p className="fine-print">No report claims to grade.</p>
      )}
      {rows.map((row) => (
        <details key={row.id}>
          <summary>
            Claim {row.claim_index + 1} ·{" "}
            {row.status === "graded"
              ? row.result.label
              : row.status === "reserved"
                ? "Outcome not recorded"
                : "Ungraded"}
          </summary>
          <div className={styles.expectations}>
            <p>{row.request.claim_preview}</p>
            <p>
              <strong>
                {row.result.reason ||
                  "A call was reserved; its outcome is not recorded. The reservation remains charged until a result is known."}
              </strong>
            </p>
            <dl className={styles.gradeMetadata}>
              <dt>Judge model</dt>
              <dd>{row.request.model_id}</dd>
              <dt>Evidence IDs</dt>
              <dd>{row.request.evidence_ids.join(", ")}</dd>
              <dt>Source versions</dt>
              <dd>{row.request.source_version_ids.join(", ")}</dd>
              <dt>Prompt hash</dt>
              <dd>{row.request.prompt_sha256}</dd>
              <dt>Contract hash</dt>
              <dd>{row.request.schema_sha256}</dd>
              <dt>Input hash</dt>
              <dd>{row.request.input_sha256}</dd>
              <dt>Context boundary</dt>
              <dd>{row.request.context_policy}</dd>
              <dt>Token accounting</dt>
              <dd>
                {row.tokens_charged.toLocaleString()} charged ·{" "}
                {row.result.usage
                  ? "provider usage"
                  : "reservation or no-call stop"}
              </dd>
              <dt>Estimated cost</dt>
              <dd>
                {row.result.estimated_cost_usd == null
                  ? "Unavailable"
                  : `$${row.result.estimated_cost_usd.toFixed(6)}`}{" "}
                · {row.result.cost_source || "no reported cost"}
              </dd>
            </dl>
          </div>
        </details>
      ))}
    </section>
  );
}
