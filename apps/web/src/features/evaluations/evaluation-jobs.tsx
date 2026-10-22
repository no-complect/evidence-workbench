import { Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EvaluationJob } from "@/lib/contracts";

function progressLabel(job: EvaluationJob) {
  if (job.progress.total)
    return `${job.progress.completed ?? 0} / ${job.progress.total} cases`;
  switch (job.status) {
    case "queued":
      return "Waiting for evaluation worker";
    case "running":
      return "Preparing benchmark";
    case "completed":
      return "Benchmark completed";
    case "cancelled":
      return "Benchmark cancelled";
    case "failed":
      return "Benchmark stopped before case results were available";
  }
}

export function EvaluationJobs({
  jobs,
  cancellingId,
  onCancel,
}: {
  jobs: EvaluationJob[];
  cancellingId: string | undefined;
  onCancel: (id: string) => void;
}) {
  return (
    <div className="benchmark-jobs" aria-live="polite">
      {jobs.slice(0, 5).map((job) => (
        <div className="benchmark-job" key={job.id}>
          <div>
            <strong>
              {job.request.custom
                ? "Collection evaluation"
                : `${job.request.split} benchmark`}
            </strong>
            <span className={`status-badge ${job.status}`}>
              {job.cancel_requested && job.status === "running"
                ? "cancelling"
                : job.status}
            </span>
            <p>
              {progressLabel(job)}
              {job.progress.case &&
                ` · ${job.progress.strategy} / ${job.progress.case}`}
            </p>
            {job.status === "running" && (
              <progress
                value={job.progress.completed ?? 0}
                max={job.progress.total || 1}
                aria-label="Completed benchmark cases"
              />
            )}
            {job.error && <p className="source-error">{job.error}</p>}
          </div>
          {(job.status === "queued" || job.status === "running") && (
            <Button
              variant="secondary"
              size="sm"
              disabled={cancellingId === job.id || job.cancel_requested}
              onClick={() => onCancel(job.id)}
            >
              <Square size={13} />
              Cancel
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
