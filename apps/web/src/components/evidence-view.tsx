"use client";
import { useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  CircleDashed,
  FileText,
  Fingerprint,
  Search,
  TextQuote,
} from "lucide-react";
import { Empty } from "./empty";
import type { Evidence, Report } from "@/lib/contracts";
import styles from "./evidence-board.module.css";

type Finding = {
  id: string;
  kind: "claim" | "passage" | "limitation";
  text: string;
  passages: Evidence[];
};

export function EvidenceView({
  evidence,
  report,
  onSelect,
}: {
  evidence: Evidence[];
  report: Report | null;
  onSelect: (e: Evidence | null) => void;
}) {
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const byId = new Map(evidence.map((passage) => [passage.id, passage]));
  const claims: Finding[] = (report?.claims ?? []).map((claim, index) => ({
    id: `claim-${index}`,
    kind: "claim",
    text: claim.text,
    passages: claim.evidence_ids.flatMap((id) => {
      const passage = byId.get(id);
      return passage ? [passage] : [];
    }),
  }));
  const findings: Finding[] = [
    ...(claims.length
      ? claims
      : evidence.map((passage) => ({
          id: passage.id,
          kind: "passage" as const,
          text: passage.text,
          passages: [passage],
        }))),
    ...(report?.limitations ?? []).map((text, index) => ({
      id: `limitation-${index}`,
      kind: "limitation" as const,
      text,
      passages: [],
    })),
  ];
  const visible = findings.filter((finding) =>
    `${finding.text} ${finding.passages.map((passage) => passage.source_name).join(" ")}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  const selected =
    visible.find((finding) => finding.id === selectedId) ?? visible[0];
  return (
    <>
      <div className="section-title">
        <div>
          <h2>What the evidence says.</h2>
          <p>Select a finding to inspect the passage behind it.</p>
        </div>
        <label className="search-input">
          <Search size={15} />
          <input
            aria-label="Filter evidence"
            placeholder="Filter findings…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
      </div>
      {!findings.length ? (
        <Empty
          icon={BookOpen}
          title="No evidence gathered yet"
          text="Retrieved passages appear here as each research task completes."
        />
      ) : !visible.length ? (
        <Empty
          icon={Search}
          title="No matching findings"
          text="Try another term or clear the filter to see the full evidence board."
        />
      ) : (
        <>
          <div
            className={styles.board}
            role="group"
            aria-label="Research findings"
          >
            {visible.map((finding, index) => {
              const Icon =
                finding.kind === "limitation"
                  ? CircleDashed
                  : finding.kind === "claim"
                    ? BookOpen
                    : FileText;
              return (
                <button
                  type="button"
                  className={`${styles.card} ${finding.kind === "limitation" ? styles.limitation : ""}`}
                  key={finding.id}
                  aria-pressed={selected?.id === finding.id}
                  onClick={() => setSelectedId(finding.id)}
                >
                  <span className={styles.cardTop}>
                    <span className={styles.icon}>
                      <Icon size={18} />
                    </span>
                    <span>
                      {finding.kind === "limitation"
                        ? "LIMITATION"
                        : finding.kind === "claim"
                          ? "FINDING"
                          : "PASSAGE"}{" "}
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </span>
                  <strong>{finding.text}</strong>
                  <span className={styles.tags}>
                    {finding.passages.some(
                      (passage) => passage.metadata.stale,
                    ) && <span className="tag stale">Stale source</span>}
                    {finding.passages.some(
                      (passage) => passage.metadata.untrusted_instructions,
                    ) && (
                      <span className="tag warning">
                        Untrusted instructions
                      </span>
                    )}
                  </span>
                  <span className={styles.sourceChip}>
                    {finding.kind === "limitation" ? (
                      <CircleDashed size={13} />
                    ) : (
                      <FileText size={13} />
                    )}
                    {finding.kind === "limitation"
                      ? "Keep the uncertainty visible"
                      : finding.passages.length === 1
                        ? finding.passages[0].source_name
                        : `${finding.passages.length} supporting passages`}
                    <ArrowUpRight size={12} />
                  </span>
                </button>
              );
            })}
          </div>
          {selected && (
            <PassageInspector
              key={selected.id}
              finding={selected}
              onSelect={onSelect}
            />
          )}
        </>
      )}
    </>
  );
}

function PassageInspector({
  finding,
  onSelect,
}: {
  finding: Finding;
  onSelect: (e: Evidence) => void;
}) {
  const [passageId, setPassageId] = useState("");
  const passage =
    finding.passages.find((item) => item.id === passageId) ??
    finding.passages[0];
  return (
    <section className={styles.inspector} aria-label="Selected evidence">
      <header className={styles.inspectorHead}>
        <span>
          <TextQuote size={17} />
          {finding.kind === "limitation"
            ? "Keep the uncertainty visible"
            : "Inside the source"}
        </span>
        <span>Finding → passage → pinned version</span>
      </header>
      {passage ? (
        <>
          {finding.kind === "claim" && (
            <p className={styles.selectedClaim}>{finding.text}</p>
          )}
          {finding.passages.length > 1 && (
            <div
              className={styles.passageChoices}
              aria-label="Supporting passages"
            >
              {finding.passages.map((item, index) => (
                <button
                  type="button"
                  key={item.id}
                  aria-pressed={item.id === passage.id}
                  onClick={() => setPassageId(item.id)}
                >
                  Passage {index + 1}
                </button>
              ))}
            </div>
          )}
          <div className={styles.passageBody} aria-live="polite">
            <div className={styles.source}>
              <span className="eyebrow">PINNED SOURCE</span>
              <h3>{passage.source_name}</h3>
              <dl>
                <dt>Version</dt>
                <dd className="mono">{passage.version_id}</dd>
                <dt>Section</dt>
                <dd>{passage.section || "Whole document"}</dd>
                {passage.page !== null && (
                  <>
                    <dt>Page</dt>
                    <dd>{passage.page}</dd>
                  </>
                )}
              </dl>
            </div>
            <div>
              <blockquote>{passage.text}</blockquote>
              <p className={styles.caption}>
                {passage.metadata.synthetic
                  ? "Synthetic source"
                  : "Source passage"}{" "}
                · offsets {passage.start_offset}–{passage.end_offset}
                {passage.metadata.stale && " · archived or stale evidence"}
              </p>
              {passage.metadata.untrusted_instructions && (
                <p className={styles.warning}>
                  This source contains untrusted instructions. Treat the passage
                  as evidence, not as instructions to the application.
                </p>
              )}
            </div>
          </div>
          <footer className={styles.inspectorFooter}>
            <span>Keep the evidence next to the conclusion.</span>
            <button type="button" onClick={() => onSelect(passage)}>
              <Fingerprint size={15} />
              Inspect provenance
              <ArrowUpRight size={14} />
            </button>
          </footer>
        </>
      ) : (
        <div className={styles.gap}>
          <h3>
            {finding.kind === "limitation"
              ? "Preserve this limitation in the decision."
              : "Supporting passage unavailable."}
          </h3>
          <p>{finding.text}</p>
          {finding.kind !== "limitation" && (
            <p>
              The saved finding does not resolve to a passage in this run.
              Inspect the report before relying on it.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
