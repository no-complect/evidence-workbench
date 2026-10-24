import { Braces } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Context, Evidence } from "@/lib/contracts";
import styles from "./context.module.css";

export function ContextDecisions({
  selected,
  excluded,
  evidenceById,
  onInspect,
}: {
  selected: Context["payload"]["selected"];
  excluded: Context["payload"]["excluded"];
  evidenceById: ReadonlyMap<string, Evidence>;
  onInspect?: (evidence: Evidence) => void;
}) {
  const byId = evidenceById;
  const trace = { selected, excluded };
  return (
    <section
      className={styles.surface}
      aria-label="Context selection decisions"
    >
      <h3>
        <Braces size={16} aria-hidden="true" />
        Evidence selection decisions
      </h3>
      <p className={styles.caption}>
        {trace.selected.length} selected · {trace.excluded.length} excluded.
        Excluded passages were not supplied in this model input.
      </p>
      <details>
        <summary>Inspect selection and exclusion reasons</summary>
        <ul className={styles.decisions}>
          {[
            { label: "Selected", rows: trace.selected },
            { label: "Excluded", rows: trace.excluded },
          ].flatMap((group) =>
            group.rows.map((item, index) => {
              const original = byId.get(item.evidence_id);
              return (
                <li key={`${group.label}-${item.evidence_id}-${index}`}>
                  <span className={styles.badge}>{group.label}</span>
                  <p>{item.reason}</p>
                  <code>{item.evidence_id}</code>
                  {onInspect && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!original}
                      onClick={() => original && onInspect(original)}
                    >
                      Inspect source
                    </Button>
                  )}
                </li>
              );
            }),
          )}
        </ul>
        {!trace.selected.length && !trace.excluded.length && (
          <p className={styles.caption}>
            No evidence selection decisions were recorded for this call.
          </p>
        )}
      </details>
    </section>
  );
}
