import { Scale } from "lucide-react";
import styles from "@/features/harness/studio.module.css";
import controls from "./evaluation-controls.module.css";
import { HelpTip } from "@/components/ui/tooltip";
import { judgeBudgetFields, type JudgeDraft } from "./judge-state";

export function JudgingOptions({
  live,
  modelId,
  enabled,
  onEnabled,
  draft,
  onChange,
  pricesKnown,
}: {
  live: boolean;
  modelId: string;
  enabled: boolean;
  onEnabled: (value: boolean) => void;
  draft: JudgeDraft;
  onChange: (key: keyof JudgeDraft, value: string) => void;
  pricesKnown: boolean;
}) {
  if (!live) return null;

  return (
    <section className={styles.note} aria-label="Semantic evaluation settings">
      <Scale size={17} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <strong>
          Separate model judgment
          <HelpTip
            label="Separate model judgment"
            content="Opt into additional model calls that assess sampled cited claims as supported, contradicted or insufficient. Unsampled and ungraded claims stay explicit; a judge grade is not independent ground truth."
          />
        </strong>
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
                value={draft.max_claims_per_run}
                onChange={(e) => onChange("max_claims_per_run", e.target.value)}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    First {n} cited {n === 1 ? "claim" : "claims"}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.fields}>
              {judgeBudgetFields
                .filter(([key]) => key !== "estimated_cost_usd" || pricesKnown)
                .map(([key, label, min, max]) => (
                  <label className={styles.field} key={key}>
                    {label}
                    <input
                      type="number"
                      required
                      min={min}
                      max={max}
                      step={key === "estimated_cost_usd" ? "any" : 1}
                      value={draft[key]}
                      onChange={(e) => onChange(key, e.target.value)}
                    />
                  </label>
                ))}
            </div>
            <p className="fine-print">
              These limits apply across judge calls for the entire suite,
              separately from research limits. Claims that cannot fit stay
              explicitly ungraded.{" "}
              {pricesKnown
                ? "The estimated cost cap uses pinned operator rates."
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
