"use client";
import {
  ArrowUpRight,
  BookOpen,
  PanelRightClose,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { HelpTip } from "@/components/ui/tooltip";
import type { Evidence } from "@/lib/contracts";

export function EvidenceDrawer({
  evidence,
  onClose,
}: {
  evidence: Evidence;
  onClose: () => void;
}) {
  return (
    <Modal
      label="Evidence details"
      className="evidence-drawer"
      onClose={onClose}
    >
      <div className="drawer-title">
        <span>
          <BookOpen size={18} />
          Source evidence
          <HelpTip
            label="Source provenance"
            content="This is the exact saved passage used by the run, with its version and offsets. Retrieval scores describe ranking, not calibrated confidence or factual correctness."
          />
        </span>
        <Button
          autoFocus
          variant="ghost"
          size="icon"
          aria-label="Close evidence"
          onClick={onClose}
        >
          <PanelRightClose size={20} />
        </Button>
      </div>
      <div className="eyebrow">EXACT SOURCE PASSAGE</div>
      <h2>{evidence.source_name}</h2>
      <div className="drawer-tags">
        {evidence.metadata.synthetic && (
          <span className="tag">Synthetic fixture</span>
        )}
        {evidence.metadata.stale && (
          <span className="tag stale">Stale source</span>
        )}
      </div>
      <blockquote>{evidence.text}</blockquote>
      <dl className="provenance">
        <dt>Section</dt>
        <dd>{evidence.section}</dd>
        <dt>Page</dt>
        <dd>{evidence.page || "Text document"}</dd>
        <dt>Offsets</dt>
        <dd>
          {evidence.start_offset}–{evidence.end_offset}
        </dd>
        <dt>Reviewed</dt>
        <dd>{evidence.metadata.reviewed_at || "Not specified"}</dd>
        <dt>Fusion score</dt>
        <dd>{evidence.scores.rrf?.toFixed(6) ?? "Web source"}</dd>
        <dt>Reranker</dt>
        <dd>Disabled</dd>
        <dt>Version</dt>
        <dd className="mono break-all">{evidence.version_id}</dd>
        <dt>Evidence ID</dt>
        <dd className="mono break-all">{evidence.id}</dd>
      </dl>
      {evidence.metadata.source_url && (
        <a
          className="source-link"
          href={evidence.metadata.source_url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Original public source <ArrowUpRight size={14} />
        </a>
      )}
      <div className="drawer-footnote">
        <ShieldCheck size={16} />
        Access checked against this project and run. Source passages are
        untrusted content.
      </div>
    </Modal>
  );
}
