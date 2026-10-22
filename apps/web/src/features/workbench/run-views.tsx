"use client";

import { useMutation } from "@tanstack/react-query";
import {
  Activity,
  BookOpen,
  Database,
  FileText,
  FlaskConical,
  Layers3,
} from "lucide-react";
import { ActivityView } from "@/components/activity-view";
import { ContextView } from "@/components/context-view";
import { EvidenceView } from "@/components/evidence-view";
import { EvaluationsView } from "@/components/evaluations-view";
import { ReportView } from "@/components/report-view";
import { ErrorNotice } from "@/components/error-notice";
import { workbenchApi } from "@/lib/workbench-api";
import type { Evidence, RunSnapshot } from "@/lib/contracts";
import { SourcesPanel } from "./sources-panel";
import { isTerminalRun } from "./queries";
import type { WorkspaceTab } from "./workspace-state";

const tabs = [
  { id: "report", label: "Report", icon: FileText },
  { id: "evidence", label: "Evidence", icon: BookOpen },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "context", label: "Context", icon: Layers3 },
  { id: "sources", label: "Sources", icon: Database },
  { id: "evaluations", label: "Evaluations", icon: FlaskConical },
] as const;

export function RunViews({
  projectId,
  collectionId,
  readOnly,
  evaluationsEnabled,
  snapshot,
  tab,
  onNavigate,
  onEvidence,
  onCreateCollection,
}: {
  projectId: string;
  collectionId: string;
  readOnly: boolean;
  evaluationsEnabled: boolean;
  snapshot: RunSnapshot | undefined;
  tab: WorkspaceTab;
  onNavigate: (tab: WorkspaceTab) => void;
  onEvidence: (evidence: Evidence | null) => void;
  onCreateCollection: () => void;
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
      <div className="tabs" role="tablist" aria-label="Research views">
        {tabs.map(({ id, label, icon: Icon }, index) => (
          <button
            type="button"
            key={id}
            id={`tab-${id}`}
            role="tab"
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
              <span>{evidence.length}</span>
            )}
          </button>
        ))}
      </div>
      <section
        className="content-panel"
        id={`panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        tabIndex={0}
      >
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
          <EvidenceView evidence={evidence} onSelect={onEvidence} />
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
        {tab === "sources" && (
          <SourcesPanel
            key={collectionId}
            projectId={projectId}
            collectionId={collectionId}
            readOnly={readOnly}
            onCreate={onCreateCollection}
          />
        )}
        {tab === "evaluations" && (
          <EvaluationsView projectId={projectId} enabled={evaluationsEnabled} />
        )}
      </section>
    </>
  );
}
