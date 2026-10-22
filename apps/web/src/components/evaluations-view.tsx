"use client";

import { useState } from "react";
import { FlaskConical, Loader2, Play } from "lucide-react";
import { Button } from "./ui/button";
import { ErrorNotice } from "./error-notice";
import type { EvaluationSplit } from "@/lib/contracts";
import { useEvaluations } from "@/features/evaluations/use-evaluations";
import { EvaluationJobs } from "@/features/evaluations/evaluation-jobs";
import { EvaluationResults } from "@/features/evaluations/evaluation-results";

export function EvaluationsView({
  projectId,
  enabled,
  active = true,
}: {
  projectId: string;
  enabled: boolean;
  active?: boolean;
}) {
  const [split, setSplit] = useState<EvaluationSplit>("development");
  const { query, start, cancel, submit } = useEvaluations(projectId, active);
  const jobs = query.data?.jobs ?? [];
  const hasActiveJob = jobs.some(
    (job) => job.status === "queued" || job.status === "running",
  );
  return (
    <>
      <section className="benchmark-launcher" aria-labelledby="benchmark-title">
        <div className="section-title">
          <div>
            <div className="eyebrow">EXPERIMENT / MEASURE / INSPECT</div>
            <h2 id="benchmark-title">Run a reproducible benchmark</h2>
            <p>
              A dedicated evaluation worker compares RAG, workflow, and bounded
              agent runs.
            </p>
          </div>
          <FlaskConical size={24} />
        </div>
        <form
          className="benchmark-controls"
          onSubmit={(event) => {
            event.preventDefault();
            if (!hasActiveJob && enabled && !query.isPending && !query.isError)
              submit(split);
          }}
        >
          <label>
            Case split
            <select
              value={split}
              disabled={start.isPending || hasActiveJob}
              onChange={(event) =>
                setSplit(event.target.value as EvaluationSplit)
              }
            >
              <option value="development">Development</option>
              <option value="held-out">Held-out</option>
              <option value="all">All cases</option>
            </select>
          </label>
          <Button
            type="submit"
            disabled={
              !projectId ||
              !enabled ||
              query.isPending ||
              query.isError ||
              start.isPending ||
              hasActiveJob
            }
          >
            {start.isPending ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Play size={16} />
            )}
            Run benchmark
          </Button>
        </form>
        <p className="fine-print">
          A fresh fixture collection is frozen for each benchmark. No model
          credentials or paid calls are used. Live model quality and custom
          collection suites are separate evaluation tracks.
        </p>
        {!enabled && (
          <p role="status">
            The built-in benchmark is available in local demo instances.
          </p>
        )}
        {!!projectId && query.isPending && (
          <p role="status">Loading evaluations…</p>
        )}
        <ErrorNotice
          title="Evaluations could not load"
          error={query.error}
          onRetry={() => void query.refetch()}
        />
        <ErrorNotice error={start.error} onDismiss={start.reset} />
        <ErrorNotice error={cancel.error} onDismiss={cancel.reset} />
        <EvaluationJobs
          jobs={jobs}
          cancellingId={cancel.isPending ? cancel.variables : undefined}
          onCancel={(id) => cancel.mutate(id)}
        />
      </section>
      <EvaluationResults evaluations={query.data?.evaluations ?? []} />
    </>
  );
}
