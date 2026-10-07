"use client";
import { useState } from "react";
import { BookOpen, Search } from "lucide-react";

import { Empty } from "./empty";
import type { Evidence } from "@/lib/api";

export function EvidenceView({
  evidence,
  onSelect,
}: {
  evidence: Evidence[];
  onSelect: (e: Evidence | null) => void;
}) {
  const [evidenceQuery, setEvidenceQuery] = useState("");
  return (
    <>
      <div className="section-title">
        <div>
          <h2>Evidence explorer</h2>
          <p>Exact passages, immutable provenance, and retrieval scores.</p>
        </div>
        <label className="search-input">
          <Search size={15} />
          <input
            aria-label="Filter evidence"
            placeholder="Filter passages…"
            value={evidenceQuery}
            onChange={(e) => setEvidenceQuery(e.target.value)}
          />
        </label>
      </div>
      {evidence.length === 0 ? (
        <Empty
          icon={BookOpen}
          title="No evidence gathered yet"
          text="Retrieved passages appear here as each research task completes."
        />
      ) : (
        <div className="evidence-grid">
          {evidence
            .filter((e) =>
              `${e.text} ${e.source_name}`
                .toLowerCase()
                .includes(evidenceQuery.toLowerCase()),
            )
            .map((e, i) => (
              <button
                className="evidence-card"
                key={e.id}
                onClick={() => onSelect(e)}
              >
                <div className="evidence-card-top">
                  <span className="evidence-number">
                    E{String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    {e.metadata.stale && (
                      <span className="tag stale">Stale</span>
                    )}
                    {e.metadata.untrusted_instructions && (
                      <span className="tag warning">Adversarial fixture</span>
                    )}
                    {e.metadata.synthetic && (
                      <span className="tag">Synthetic</span>
                    )}
                  </div>
                </div>
                <h3>{e.source_name.replace(".md", "")}</h3>
                <p>{e.text}</p>
                <footer>
                  <span>{e.section.slice(0, 40)}</span>
                  <span className="mono">
                    RRF {(e.scores.rrf || 0).toFixed(4)}
                  </span>
                </footer>
              </button>
            ))}
        </div>
      )}
    </>
  );
}
