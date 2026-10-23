"use client";
import { useState } from "react";
import { useSavedJudgments } from "./judgment-queries";
import { ErrorNotice } from "@/components/error-notice";
import { SemanticGrades } from "./semantic-grades";

export function SavedJudgments({
  projectId,
  jobId,
  active,
  running,
}: {
  projectId: string;
  jobId: string;
  active: boolean;
  running: boolean;
}) {
  const [open, setOpen] = useState(false);
  const query = useSavedJudgments(projectId, jobId, open && active, running);
  return (
    <details
      onToggle={(e) => setOpen(e.currentTarget.open)}
      style={{ margin: "12px 0 22px" }}
    >
      <summary>Inspect saved model judgments</summary>
      {open && (
        <>
          <ErrorNotice
            error={query.error}
            onRetry={() => void query.refetch()}
          />
          {query.isPending ? (
            <p role="status">Loading saved judgments…</p>
          ) : query.data?.length ? (
            <SemanticGrades rows={query.data} />
          ) : (
            !query.error && (
              <p className="fine-print">
                No claim grading calls have been reserved for this evaluation.
              </p>
            )
          )}
        </>
      )}
    </details>
  );
}
