import { Scale } from "lucide-react";
import styles from "@/features/harness/studio.module.css";
import controls from "./evaluation-controls.module.css";

export function JudgingOptions({
  live,
  modelId,
  enabled,
  onEnabled,
  claims,
  onClaims,
  pricesKnown,
}: {
  live: boolean;
  modelId: string;
  enabled: boolean;
  onEnabled: (value: boolean) => void;
  claims: number;
  onClaims: (value: number) => void;
  pricesKnown: boolean;
}) {
  if (!live) return null;

  return (
    <section className={styles.note} aria-label="Semantic evaluation settings">
      <Scale size={17} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <strong>Separate model judgment</strong>
        {modelId ? (
          <label className={controls.checkbox}>
            <input
              type="checkbox"
              aria-label="Enable semantic judging"
              checked={enabled}
              onChange={(e) => onEnabled(e.target.checked)}
            />
            <span>Grade sampled cited claims with the evaluation judge.</span>
          </label>
        ) : null}
        <p className="fine-print">
          {modelId
            ? `Judge: ${modelId}. This model choice is separate from the writer.`
            : "Model grading is optional. Select an evaluation judge in Harness to enable it."}
        </p>
        {modelId && enabled && (
          <>
            <label className={styles.field}>
              Claims sampled per investigation
              <select
                aria-label="Claims sampled per investigation"
                value={claims}
                onChange={(e) => onClaims(Number(e.target.value))}
              >
                {[1, 2, 3, 5].map((n) => (
                  <option key={n} value={n}>
                    First {n} cited {n === 1 ? "claim" : "claims"}
                  </option>
                ))}
              </select>
            </label>
            <p className="fine-print">
              Separate suite limits: 24,000 judge tokens and a 120-second
              grading window.{" "}
              {pricesKnown
                ? "Estimated judge cost cap: $1 at pinned operator rates."
                : "Dollar estimates and the dollar cap are unavailable for this model; token, sample and time limits still apply."}{" "}
              Failed or uncertain calls retain their reservations.
            </p>
            <p className="fine-print">
              Supported, contradicted, or insufficient describes a fallible
              model judgment. Unsampled and ungraded claims remain explicit.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
