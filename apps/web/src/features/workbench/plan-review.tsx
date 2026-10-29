"use client";

import { useState } from "react";
import { CheckCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/error-notice";
import type { Plan } from "@/lib/contracts";
import { useApprovePlan } from "./mutations";

export function PlanReview({
  projectId,
  runId,
  initialPlan,
  onApproved,
}: {
  projectId: string;
  runId: string;
  initialPlan: Plan;
  onApproved: () => void;
}) {
  // An intentional editable draft. Polling server data must not overwrite human edits.
  // The caller keys this component by run ID so a different run starts a new draft.
  const [draft, setDraft] = useState(initialPlan);
  const approval = useApprovePlan(projectId, runId);
  return (
    <form
      className="plan-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!approval.isPending)
          approval.mutate(draft, { onSuccess: onApproved });
      }}
    >
      <div className="section-title">
        <div>
          <span className="eyebrow">YOUR REVIEW</span>
          <h2>A plan before we proceed</h2>
        </div>
        <span className="status-badge awaiting_approval">
          Approval required
        </span>
      </div>
      <p>{draft.rationale}</p>
      <div className="plan-tasks">
        {draft.tasks.map((task, index) => (
          <label key={task.id}>
            <span className="task-number">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div>
              <strong>{task.topic}</strong>
              <input
                required
                minLength={3}
                maxLength={600}
                aria-label={`${task.topic} research question`}
                value={task.question}
                onChange={(event) => {
                  const question = event.target.value;
                  setDraft((previous) => ({
                    ...previous,
                    tasks: previous.tasks.map((item) =>
                      item.id === task.id ? { ...item, question } : item,
                    ),
                  }));
                }}
              />
            </div>
          </label>
        ))}
      </div>
      <ErrorNotice error={approval.error} onDismiss={approval.reset} />
      <div className="plan-actions">
        <span>
          Edits are saved when you approve. Research resumes from its
          checkpoint.
        </span>
        <Button
          help="Save your edited plan and resume the worker from its approval checkpoint. Live research continues using the run's pinned model configuration and limits."
          type="submit"
          disabled={approval.isPending}
        >
          {approval.isPending ? (
            <Loader2 size={14} className="spin" />
          ) : (
            <CheckCheck size={16} />
          )}
          Approve &amp; investigate
        </Button>
      </div>
    </form>
  );
}
