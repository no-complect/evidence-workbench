"use client";

import { useEffect, useRef, useState } from "react";
import { FlaskConical, Loader2, Play, Square } from "lucide-react";
import { Button } from "./ui/button";

import { Empty } from "./empty";
import { api, type Evaluation, type EvaluationJob } from "@/lib/api";

function EvaluationResults({
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
          text="Run a benchmark above to compare the three strategies against a fixed corpus. Fixture results measure integration and retrieval behavior, not live model quality."
        />
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
            {!!e.raw?.length && <details>
              <summary>Inspect {e.raw.length} case results</summary>
              <div className="table-scroll"><table><thead><tr><th>Case</th><th>Strategy</th><th>Status</th><th>Checks</th><th>Retrieved sources</th></tr></thead><tbody>
                {e.raw.map(row => <tr key={`${row.strategy}/${row.case}`}>
                  <td>{row.case}</td><td>{row.strategy}</td><td>{row.status}</td>
                  <td>{Object.entries(row.checks).map(([name, passed]) => `${name}: ${passed ? "pass" : "fail"}`).join(" · ") || "No extra case assertions"}</td>
                  <td>{row.ranked_sources.join(", ")}</td>
                </tr>)}
              </tbody></table></div>
            </details>}
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


export function EvaluationsView({ projectId, enabled }: { projectId: string; enabled: boolean }) {
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [jobs, setJobs] = useState<EvaluationJob[]>([]);
  const [split, setSplit] = useState("development");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const requestKey = useRef<string | null>(null);
  const active = jobs.find(j => j.status === "queued" || j.status === "running");

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const [results, nextJobs] = await Promise.all([
          api<Evaluation[]>(`projects/${projectId}/evaluations`),
          api<EvaluationJob[]>(`projects/${projectId}/evaluation-jobs`),
        ]);
        if (!alive) return;
        setEvaluations(results);
        setJobs(nextJobs);
        setError("");
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Unable to load evaluations");
      }
      if (alive) timer = setTimeout(refresh, 3000);
    }
    void refresh();
    return () => { alive = false; clearTimeout(timer); };
  }, [projectId, revision]);

  async function submit() {
    setPending(true); setError("");
    requestKey.current ||= crypto.randomUUID();
    try {
      const job = await api<EvaluationJob>(`projects/${projectId}/evaluation-jobs`, {
        method: "POST", body: JSON.stringify({ split, idempotency_key: requestKey.current }),
      });
      setJobs(previous => [job, ...previous.filter(j => j.id !== job.id)]);
      requestKey.current = null;
      setRevision(n => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to queue evaluation"); }
    finally { setPending(false); }
  }
  async function cancel(job: EvaluationJob) {
    setPending(true); setError("");
    try {
      await api(`projects/${projectId}/evaluation-jobs/${job.id}/cancel`, { method: "POST" });
      setJobs(previous => previous.map(j => j.id === job.id ? { ...j, cancel_requested: true } : j));
      setRevision(n => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to cancel evaluation"); }
    finally { setPending(false); }
  }

  return <>
    <section className="benchmark-launcher" aria-labelledby="benchmark-title">
      <div className="section-title"><div><div className="eyebrow">EXPERIMENT / MEASURE / INSPECT</div><h2 id="benchmark-title">Run a reproducible benchmark</h2><p>A dedicated evaluation worker compares RAG, workflow, and bounded agent runs.</p></div><FlaskConical size={24} /></div>
      <div className="benchmark-controls">
        <label>Case split<select value={split} disabled={pending || !!active} onChange={e => { setSplit(e.target.value); requestKey.current = null; }}><option value="development">Development</option><option value="held-out">Held-out</option><option value="all">All cases</option></select></label>
        <Button disabled={!projectId || !enabled || pending || !!active} onClick={() => void submit()}>{pending ? <Loader2 size={16} className="spin" /> : <Play size={16} />}Run benchmark</Button>
      </div>
      <p className="fine-print">A fresh fixture collection is frozen for each benchmark. No model credentials or paid calls are used. Live model quality and custom collection suites are separate evaluation tracks.</p>
      {!enabled && <p role="status">The built-in benchmark is available in local demo instances.</p>}
      {error && <p className="source-error" role="alert">{error}</p>}
      <div className="benchmark-jobs" aria-live="polite">
        {jobs.slice(0, 5).map(job => <div className="benchmark-job" key={job.id}>
          <div><strong>{job.request.split} benchmark</strong><span className={`status-badge ${job.status}`}>{job.cancel_requested && job.status === "running" ? "cancelling" : job.status}</span>
            <p>{job.progress.total ? `${job.progress.completed || 0} / ${job.progress.total} cases` : job.status === "queued" ? "Waiting for evaluation worker" : "Preparing benchmark"}{job.progress.case ? ` · ${job.progress.strategy} / ${job.progress.case}` : ""}</p>
            {job.status === "running" && <progress value={job.progress.completed || 0} max={job.progress.total || 1} aria-label="Completed benchmark cases" />}
            {job.error && <p className="source-error">{job.error}</p>}
          </div>
          {(job.status === "queued" || job.status === "running") && <Button variant="secondary" size="sm" disabled={pending || job.cancel_requested} onClick={() => void cancel(job)}><Square size={13} />Cancel</Button>}
        </div>)}
      </div>
    </section>
    <EvaluationResults evaluations={evaluations} />
  </>;
}
