import { ShieldCheck, ScanSearch, Quote, AlertCircle } from "lucide-react";
import styles from "@/features/harness/studio.module.css";
import { HelpTip } from "@/components/ui/tooltip";
const measures = [
  [
    ScanSearch,
    "Retrieval relevance",
    "Do expected sources appear among the top retained evidence passages?",
  ],
  [
    ShieldCheck,
    "Citation validity",
    "Does each citation resolve to evidence in the authorized run?",
  ],
  [
    Quote,
    "Quote support",
    "Does each direct quotation occur in its source passage?",
  ],
  [
    AlertCircle,
    "Gap disclosure",
    "Does the report contain the explicitly expected disclosure text?",
  ],
] as const;

export function EvaluationMeasurements() {
  return (
    <section className={styles.surface} aria-label="Evaluation measurements">
      <div className={styles.head}>
        What gets measured
        <HelpTip
          label="Evaluation measurements"
          content="Retrieval, citation resolution, exact quotations and disclosure checks measure different properties. None alone establishes factual correctness. Optional model judgments are fallible and reported separately."
        />
      </div>
      <div className={styles.pad}>
        {measures.map(([Icon, title, description]) => (
          <div
            key={title}
            className={styles.check}
            style={{ alignItems: "start", marginBottom: 21 }}
          >
            <Icon size={18} />
            <div>
              <strong style={{ color: "var(--foreground)", fontSize: 13 }}>
                {title}
              </strong>
              <p className="fine-print" style={{ marginTop: 5 }}>
                {description}
              </p>
            </div>
          </div>
        ))}
      </div>
      <div className={styles.annotation}>
        <strong>SEPARATE EVALUATION SERVICE</strong>The API queues a durable
        job. The evaluation worker orchestrates its cases; the research worker
        executes each investigation. Progress and case results are persisted
        independently of the browser.
      </div>
      <div className={styles.annotation}>
        <strong>KNOW THE LIMITS</strong>Fixture checks measure integration
        behavior. Retrieval relevance and citation validity are separate from
        factual correctness. Collection suites inspect retained run evidence;
        fixture benchmarks use an independent retrieval probe. Optional live
        model judgments grade sampled cited claims separately; they are fallible
        assessments, not independent ground truth.
      </div>
    </section>
  );
}
