import type { Run } from "@/lib/contracts";
import type { WorkspaceTab } from "./workspace-state";
import styles from "./investigation-header.module.css";
const steps = [
  ["Scope the question", "execution"],
  ["Review the plan", "execution"],
  ["Explore the evidence", "evidence"],
  ["Read the brief", "report"],
] as const;
export function InvestigationHeader({
  run,
  collectionName,
  evidenceCount,
  onNavigate,
}: {
  run: Run;
  collectionName: string;
  evidenceCount: number;
  onNavigate: (tab: WorkspaceTab) => void;
}) {
  const boundary = run.question.indexOf(". ");
  const title =
    boundary > 0 ? run.question.slice(0, boundary + 1) : run.question;
  const detail =
    boundary > 0
      ? run.question.slice(boundary + 2)
      : "Inspect the plan, evidence, and conclusions from this saved investigation.";
  const step = run.report ? 3 : evidenceCount > 0 ? 2 : run.plan ? 1 : 0;
  return (
    <>
      <div className={styles.meta}>
        <span>{collectionName} / Saved investigation</span>
        <span className={`mode-badge ${run.mode}`}>
          {run.mode === "demo" ? "SCRIPTED DEMO" : "LIVE INFERENCE"}
        </span>
      </div>
      <section className={styles.question} aria-label="Investigation question">
        <div className={styles.kicker}>THE QUESTION</div>
        <h1>{title}</h1>
        <p>{detail}</p>
        <div className={styles.journey} aria-label="Investigation journey">
          {steps.map(([label, tab], i) => (
            <button
              type="button"
              key={label}
              aria-current={step === i ? "step" : undefined}
              onClick={() => onNavigate(tab)}
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              {label}
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
