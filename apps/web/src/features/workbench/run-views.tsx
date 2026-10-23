"use client";

import { useMutation } from "@tanstack/react-query";
import { Activity, BookOpen, FileText, Layers3, Workflow } from "lucide-react";
import { ExecutionView } from "./execution-view";
import type { ResearchStrategy } from "./research-state";
import { ActivityView } from "@/components/activity-view";
import { ContextView } from "@/components/context-view";
import { EvidenceView } from "@/components/evidence-view";
import { ReportView } from "@/components/report-view";
import { ErrorNotice } from "@/components/error-notice";
import { workbenchApi } from "@/lib/workbench-api";
import type { Evidence, RunSnapshot } from "@/lib/contracts";
import { isTerminalRun } from "./queries";
import type { WorkspaceTab } from "./workspace-state";
import styles from "./run-views.module.css";

const tabs = [
  { id: "execution", label: "Execution", icon: Workflow },
  { id: "report", label: "Decision brief", icon: FileText },
  { id: "evidence", label: "Evidence board", icon: BookOpen },
  { id: "activity", label: "Research trail", icon: Activity },
  { id: "context", label: "Context", icon: Layers3 },
] as const;

export function RunViews({
  projectId,
  strategy,
  onStrategyChange,
  onHarness,
  snapshot,
  tab,
  onNavigate,
  onEvidence,
}: {
  projectId: string;
  strategy: ResearchStrategy;
  onStrategyChange: (value: ResearchStrategy) => void;
  onHarness: () => void;
  snapshot: RunSnapshot | undefined;
  tab: WorkspaceTab;
  onNavigate: (tab: WorkspaceTab) => void;
  onEvidence: (evidence: Evidence | null) => void;
}) {
  const run = snapshot?.detail.run;
  const evidence = snapshot?.detail.evidence ?? [];
  const reportExport = useMutation({
    mutationFn: () => {
      if (!run) throw new Error("Select a completed run first");
      return workbenchApi.export(projectId, run.id);
    },
  });
  return (
    <>
      <div className={styles.tabs} role="tablist" aria-label="Research views">
        {tabs.map(({ id, label, icon: Icon }, index) => (
          <button
            type="button"
            key={id}
            id={`tab-${id}`}
            role="tab"
            aria-label={label}
            aria-describedby={
              id === "evidence" && evidence.length > 0
                ? "evidence-count"
                : undefined
            }
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => onNavigate(id)}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? tabs[0]
                  : event.key === "End"
                    ? tabs[tabs.length - 1]
                    : tabs[
                        (index +
                          (event.key === "ArrowRight" ? 1 : tabs.length - 1)) %
                          tabs.length
                      ];
              onNavigate(next.id);
              document.getElementById(`tab-${next.id}`)?.focus();
            }}
          >
            <Icon size={16} />
            {label}
            {id === "evidence" && evidence.length > 0 && (
              <span id="evidence-count">
                {evidence.length}
                <span className="sr-only"> passages</span>
              </span>
            )}
          </button>
        ))}
      </div>
      <section
        className={styles.panel}
        data-view={tab}
        id={`panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        tabIndex={0}
      >
        {tab === "execution" && (
          <ExecutionView
            key={run?.id ?? "new"}
            snapshot={snapshot}
            strategy={strategy}
            onStrategyChange={onStrategyChange}
            onHarness={onHarness}
            onEvidence={() => onNavigate("evidence")}
          />
        )}
        {tab === "report" && (
          <>
            <ErrorNotice
              error={reportExport.error}
              onDismiss={reportExport.reset}
            />
            <ReportView
              run={run}
              evidence={evidence}
              onSelect={onEvidence}
              onExport={() => reportExport.mutate()}
            />
          </>
        )}
        {tab === "evidence" && (
          <EvidenceView
            evidence={evidence}
            report={run?.report ?? null}
            onSelect={onEvidence}
          />
        )}
        {tab === "activity" && (
          <ActivityView
            events={snapshot?.events ?? []}
            running={
              !!run &&
              !isTerminalRun(run.status) &&
              run.status !== "awaiting_approval"
            }
            evidence={evidence}
            onSelect={onEvidence}
          />
        )}
        {tab === "context" && (
          <ContextView contexts={snapshot?.detail.contexts ?? []} />
        )}
      </section>
    </>
  );
}
