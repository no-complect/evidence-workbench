"use client";

import { Activity, BookOpen, Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/error-notice";
import type { Run } from "@/lib/contracts";
import { useCancelResearch } from "./mutations";
import { isTerminalRun } from "./queries";

export function RunStrip({
  projectId,
  run,
  evidenceCount,
}: {
  projectId: string;
  run: Run;
  evidenceCount: number;
}) {
  const cancel = useCancelResearch(projectId, run.id);
  const running =
    !isTerminalRun(run.status) && run.status !== "awaiting_approval";
  return (
    <>
      <section className="run-strip" aria-live="polite">
        <div>
          <span className={`status-badge ${run.status}`}>
            {running && <Loader2 size={13} className="spin" />}
            {run.status.replaceAll("_", " ")}
          </span>
          <span className="run-short mono">{run.id.slice(0, 8)}</span>
        </div>
        <div className="run-metrics">
          <span>
            <BookOpen size={14} />
            {evidenceCount} passages
          </span>
          <span>
            <Activity size={14} />
            {run.tools_used} calls
          </span>
          <span>{run.tokens_used.toLocaleString()} tokens*</span>
          <span>${Number(run.cost_used).toFixed(4)} est.</span>
          {!isTerminalRun(run.status) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => cancel.mutate()}
              disabled={cancel.isPending || run.cancel_requested}
            >
              <Square size={12} />
              {run.cancel_requested || cancel.isPending
                ? "Cancelling"
                : "Cancel"}
            </Button>
          )}
        </div>
      </section>
      <ErrorNotice error={cancel.error} onDismiss={cancel.reset} />
    </>
  );
}
