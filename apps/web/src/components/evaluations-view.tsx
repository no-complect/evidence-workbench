"use client";
import { ErrorNotice } from "./error-notice";
import { useEvaluations } from "@/features/evaluations/use-evaluations";
import { EvaluationJobs } from "@/features/evaluations/evaluation-jobs";
import { EvaluationResults } from "@/features/evaluations/evaluation-results";
import layout from "@/features/evaluations/evaluation-layout.module.css";
import {
  EvaluationEditor,
  type EvaluationSetup,
} from "@/features/evaluations/evaluation-editor";
export function EvaluationsView({
  projectId,
  enabled,
  active = true,
  setup,
  onOpenRun,
}: {
  projectId: string;
  enabled: boolean;
  active?: boolean;
  setup?: EvaluationSetup;
  onOpenRun: (runId: string) => void;
}) {
  const { query, start, cancel, submit } = useEvaluations(projectId, active);
  const jobs = query.data?.jobs ?? [];
  const hasActive = jobs.some(
    (job) => job.status === "queued" || job.status === "running",
  );
  return (
    <div className={layout.workspace}>
      <EvaluationEditor
        projectId={projectId}
        enabled={enabled}
        active={active}
        busy={start.isPending || hasActive}
        pending={query.isPending || query.isError}
        onSubmit={submit}
        setup={setup}
      />
      <div className={layout.feedback}>
        <ErrorNotice
          title="Evaluations could not load"
          error={query.error}
          onRetry={() => void query.refetch()}
        />
        <ErrorNotice error={start.error} onDismiss={start.reset} />
        <ErrorNotice error={cancel.error} onDismiss={cancel.reset} />
      </div>
      {jobs.length > 0 && (
        <section aria-label="Evaluation jobs">
          <EvaluationJobs
            projectId={projectId}
            active={active}
            jobs={jobs}
            cancellingId={cancel.isPending ? cancel.variables : undefined}
            onCancel={(id) => cancel.mutate(id)}
          />
        </section>
      )}
      <EvaluationResults
        evaluations={query.data?.evaluations ?? []}
        onOpenRun={onOpenRun}
      />
    </div>
  );
}
