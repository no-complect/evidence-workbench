"use client";

import { FlaskConical } from "lucide-react";

import { Empty } from "./empty";
import type { Evaluation } from "@/lib/api";

export function EvaluationsView({
  evaluations,
}: {
  evaluations: Evaluation[];
}) {
  return (
    <>
      <div className="section-title">
        <div>
          <h2>Evaluation comparisons</h2>
          <p>
            Comparable corpus, questions, and budgets across three strategies.
          </p>
        </div>
        <FlaskConical className="muted" size={23} />
      </div>
      {evaluations.length === 0 ? (
        <Empty
          icon={FlaskConical}
          title="Measure before making claims"
          text="Run the local comparison suite to populate this view. Fixture results measure integration and retrieval behavior, not live model quality."
        >
          <code className="command">./scripts/eval.sh</code>
        </Empty>
      ) : (
        evaluations.map((e) => (
          <div className="evaluation" key={e.id}>
            <div className="flex-row">
              <span className="mode-badge">
                {e.mode.toUpperCase()} EVALUATION
              </span>
              <span className="fine-print">
                {new Date(e.created_at).toLocaleString()}
              </span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Strategy</th>
                    <th>Recall@5</th>
                    <th>MRR</th>
                    <th>Valid citations</th>
                    <th>Quote support*</th>
                    <th>Completed</th>
                    <th>Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {e.results.map((r) => (
                    <tr key={r.strategy}>
                      <td>
                        <strong>{r.strategy}</strong>
                      </td>
                      <td>
                        {r.recall_at_k === null
                          ? "—"
                          : (100 * r.recall_at_k).toFixed(0) + "%"}
                      </td>
                      <td>{r.mrr?.toFixed(2) ?? "—"}</td>
                      <td>{(100 * r.citation_validity).toFixed(0)}%</td>
                      <td>
                        {r.quote_support === null
                          ? "—"
                          : (100 * r.quote_support).toFixed(0) + "%"}
                      </td>
                      <td>{(100 * r.completion_rate).toFixed(0)}%</td>
                      <td>{r.mean_latency_seconds.toFixed(2)}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="fine-print">
              *Exact substring support for fixture quotes. This is not a
              semantic judge of arbitrary synthesis. See exported raw results
              for case-level measurements.
            </p>
            <details>
              <summary>Reproducibility manifest</summary>
              <pre>{JSON.stringify(e.versions, null, 2)}</pre>
            </details>
          </div>
        ))
      )}
    </>
  );
}
