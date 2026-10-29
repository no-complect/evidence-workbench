"use client";

import { Database, Download, FileText, ShieldCheck } from "lucide-react";

import { Empty } from "@/components/empty";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { Run, Evidence } from "@/lib/api";

import styles from "./decision-brief.module.css";

export function ReportView({
  run,
  evidence,
  onSelect,
  onExport,
}: {
  run: Run | undefined;
  evidence: Evidence[];
  onSelect: (e: Evidence | null) => void;
  onExport: () => void;
}) {
  return run?.report ? (
    <article className={`report ${styles.brief}`}>
      <div className={styles.main}>
        <div className="report-header">
          <div>
            <div className="eyebrow">
              DECISION BRIEF · {run.mode.toUpperCase()}
            </div>
            <h2>{run.report.title}</h2>
          </div>
          <Button
            help="Request the saved report export for this investigation. Exporting does not rerun research or call a model."
            variant="secondary"
            size="sm"
            onClick={onExport}
          >
            <Download size={14} />
            Markdown
          </Button>
        </div>
        {run.report.partial && (
          <div className="partial-notice">
            Partial report · execution stopped before all research was complete.
          </div>
        )}
        <p className="report-summary">{run.report.summary}</p>
        <div className="report-meta">
          <span>
            <ShieldCheck size={15} />
            {run.report.claims.length} cited claims
          </span>
          <span>
            <Database size={15} />
            {new Set(evidence.map((e) => e.source_name)).size} sources inspected
          </span>
          <span>Reranker disabled</span>
        </div>
        <h3>Findings & supporting evidence</h3>
        {run.report.claims.length === 0 && (
          <p>No supported claims could be made from the available evidence.</p>
        )}
        {run.report.claims.map((claim, i) => (
          <div className={styles.claim} key={i}>
            <div>
              <p>
                {claim.text}
                {claim.evidence_ids.map((id) => (
                  <Tooltip
                    key={id}
                    content="Open the cited passage and its saved provenance. Citation resolution alone does not prove that this passage supports the claim."
                  >
                    <button
                      className="citation"
                      aria-label={`Open citation ${evidence.findIndex((e) => e.id === id) + 1}`}
                      onClick={() =>
                        onSelect(evidence.find((e) => e.id === id) || null)
                      }
                    >
                      {evidence.findIndex((e) => e.id === id) + 1}
                    </button>
                  </Tooltip>
                ))}
              </p>
              <span className="support-label">
                {claim.support === "direct_quote"
                  ? "VERIFIED EXACT EXCERPT"
                  : "MODEL-ASSESSED SUPPORT · REVIEW REQUIRED"}
              </span>
            </div>
          </div>
        ))}
        {run.report.recommendations.length > 0 && (
          <>
            <h3>Recommended next steps</h3>
            <ul>
              {run.report.recommendations.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </>
        )}
      </div>
      <aside className={styles.side} aria-label="Unresolved findings">
        <div className={styles.label}>UNRESOLVED</div>
        <h3>The constraints stay with the conclusion.</h3>
        {run.report.limitations.length ? (
          <ul>
            {run.report.limitations.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        ) : (
          <p>
            No limitations were recorded by this run. Review the source evidence
            before relying on its recommendations.
          </p>
        )}
        <div className={styles.label} style={{ marginTop: 25 }}>
          READ THE EVIDENCE
        </div>
        <p>
          Citation controls open the exact pinned passage and its provenance.
          Exact-quote checks establish text occurrence; synthesized claims still
          need review.
        </p>
      </aside>
    </article>
  ) : (
    <Empty
      icon={FileText}
      title={
        run
          ? run.status === "failed"
            ? "This investigation stopped"
            : run.status === "cancelled"
              ? "Investigation cancelled"
              : "Your report is taking shape"
          : "A clear answer starts with a good question"
      }
      text={
        run
          ? run.error ||
            (run.status === "awaiting_approval"
              ? "Review the research plan above to continue."
              : "Open Activity to inspect saved progress. Sources and evidence remain available as the worker proceeds.")
          : "Choose a collection and start an investigation. Follow the research, inspect its evidence, and trace every cited claim to its source."
      }
    >
      <div className="empty-steps">
        <span>
          <span>01</span>Frame the question
        </span>
        <span>
          <span>02</span>Examine the evidence
        </span>
        <span>
          <span>03</span>Review the findings
        </span>
      </div>
    </Empty>
  );
}
