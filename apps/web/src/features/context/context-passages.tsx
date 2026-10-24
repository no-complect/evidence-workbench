import { BookOpen, Fingerprint } from "lucide-react";
import { HelpTip } from "@/components/ui/tooltip";
import type { savedContextInput } from "./context-record";
import { Button } from "@/components/ui/button";
import type { Context, Evidence } from "@/lib/contracts";
import styles from "./context.module.css";

export function ContextPassages({
  input,
  selected,
  evidenceById,
  onInspect,
}: {
  input: ReturnType<typeof savedContextInput>;
  selected: Context["payload"]["selected"];
  evidenceById: ReadonlyMap<string, Evidence>;
  onInspect?: (evidence: Evidence) => void;
}) {
  const byId = evidenceById;
  const trace = { selected };
  return (
    <section
      className={styles.surface}
      aria-label="Retrieved passages in model context"
    >
      <h3>
        <BookOpen size={16} aria-hidden="true" />
        Retrieved passages <span className={styles.badge}>Untrusted input</span>
        <HelpTip
          label="Retrieved context passages"
          content="These excerpts come from the saved redacted model input. Inspect source opens the matching authorized evidence record; its original text may differ because this context view is redacted."
        />
      </h3>
      <p className={styles.caption}>
        The passages actually present in this saved input. Retrieval rank is not
        confidence or proof that a claim is supported.
      </p>
      {input.passages.length ? (
        <ol className={styles.passages}>
          {input.passages.map((passage, index) => {
            const original = byId.get(passage.evidenceId);
            const decision = trace.selected.find(
              (item) => item.evidence_id === passage.evidenceId,
            );
            return (
              <li key={`${passage.evidenceId}-${index}`}>
                <details open={index === 0}>
                  <summary>
                    {passage.source ??
                      `Evidence ${passage.evidenceId.slice(0, 8)}`}
                    {passage.section && (
                      <span className={styles.caption}>
                        {" "}
                        · {passage.section}
                      </span>
                    )}
                  </summary>
                  <blockquote className={styles.passage}>
                    {passage.passage}
                  </blockquote>
                  <p className={styles.caption}>
                    {decision?.reason ??
                      "No selection reason was recorded for this passage."}
                  </p>
                  <dl className={styles.metadata}>
                    <dt>Evidence ID</dt>
                    <dd>{passage.evidenceId}</dd>
                    <dt>Source version</dt>
                    <dd>
                      {original?.version_id ?? "Not available in this run"}
                    </dd>
                    <dt>Saved offsets</dt>
                    <dd>
                      {passage.offsets
                        ? `${passage.offsets[0]}–${passage.offsets[1]}`
                        : "Not recorded"}
                    </dd>
                    {passage.page !== null && (
                      <>
                        <dt>Page</dt>
                        <dd>{passage.page}</dd>
                      </>
                    )}
                  </dl>
                  {onInspect ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!original}
                      help="Open the original authorized source passage and its immutable version. The saved model input above remains redacted."
                      onClick={() => original && onInspect(original)}
                    >
                      <Fingerprint size={14} />
                      Inspect source
                    </Button>
                  ) : (
                    <p className={styles.caption}>
                      Open Context in Workflows to inspect the original source.
                    </p>
                  )}
                </details>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className={styles.caption}>
          {input.sourcesRecorded && !input.unreadablePassages
            ? "No source passages were included in this saved input. Planning can run before retrieval."
            : "The saved source list could not be read. Inspect the raw saved input below."}
        </p>
      )}
      {input.unreadablePassages > 0 && (
        <p role="status" className={styles.caption}>
          {input.unreadablePassages} saved source entries could not be
          displayed. Inspect the raw saved input below.
        </p>
      )}
    </section>
  );
}
