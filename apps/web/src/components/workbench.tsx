"use client";

import { useReducer, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ErrorNotice } from "./error-notice";
import { ApiError } from "@/lib/api";
import type { Bootstrap, Project } from "@/lib/contracts";
import { AuthPanel } from "@/features/workbench/auth-panel";
import { CreateDialog } from "@/features/workbench/create-dialog";
import { EvidenceDrawer } from "@/features/workbench/evidence-drawer";
import { PlanReview } from "@/features/workbench/plan-review";
import { ResearchComposer } from "@/features/workbench/research-composer";
import { RunStrip } from "@/features/workbench/run-strip";
import { RunViews } from "@/features/workbench/run-views";
import {
  WorkspaceFrame,
  WorkspaceSidebar,
} from "@/features/workbench/workspace-shell";
import {
  bootstrapOptions,
  projectOptions,
  useResearchRun,
  isTerminalRun,
} from "@/features/workbench/queries";
import {
  initialWorkspaceState,
  workspaceReducer,
  resolveSelection,
  type WorkspaceAction,
} from "@/features/workbench/workspace-state";

export function Workbench() {
  const bootstrap = useQuery(bootstrapOptions());
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const project = resolveSelection(
    bootstrap.data?.projects ?? [],
    selectedProjectId,
  );
  const needsAuth =
    process.env.NEXT_PUBLIC_AUTH_MODE === "supabase" &&
    bootstrap.error instanceof ApiError &&
    bootstrap.error.status === 401;
  return (
    <ProjectWorkspace
      key={project?.id ?? "unselected"}
      project={project}
      bootstrap={bootstrap.data}
      connection={
        bootstrap.isPending
          ? "connecting"
          : bootstrap.isError
            ? "offline"
            : "connected"
      }
      bootstrapError={bootstrap.error}
      needsAuth={needsAuth}
      onRetryBootstrap={() => void bootstrap.refetch()}
      onProjectChange={setSelectedProjectId}
    />
  );
}

function ProjectWorkspace({
  project,
  bootstrap,
  connection,
  bootstrapError,
  needsAuth,
  onRetryBootstrap,
  onProjectChange,
}: {
  project: Project | undefined;
  bootstrap: Bootstrap | undefined;
  connection: "connecting" | "connected" | "offline";
  bootstrapError: Error | null;
  needsAuth: boolean;
  onRetryBootstrap: () => void;
  onProjectChange: (id: string) => void;
}) {
  // A project-keyed boundary resets drafts, overlays and navigation atomically.
  // Server records are read directly from query caches rather than copied to state.
  const [ui, dispatch] = useReducer(workspaceReducer, initialWorkspaceState);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const projectId = project?.id ?? "";
  const projectQuery = useQuery(projectOptions(projectId));
  const runQuery = useResearchRun(projectId, ui.runId);
  const collection = resolveSelection(
    projectQuery.data?.collections ?? [],
    ui.collectionId,
  );
  const collectionId = collection?.id ?? "";
  const run = runQuery.data?.detail.run;
  const running =
    !!run && !isTerminalRun(run.status) && run.status !== "awaiting_approval";
  const overlay = ui.overlay;
  const evidence =
    overlay?.kind === "evidence"
      ? runQuery.data?.detail.evidence.find(
          (item) => item.id === overlay.evidenceId,
        )
      : undefined;
  const action = (next: WorkspaceAction) => {
    dispatch(next);
    setSidebarOpen(false);
  };
  const closeOverlay = () => dispatch({ type: "show-overlay", overlay: null });
  return (
    <WorkspaceFrame
      projectName={project?.name ?? "Research"}
      connection={connection}
      menuOpen={sidebarOpen}
      onToggleMenu={() => setSidebarOpen((previous) => !previous)}
      navigation={
        <WorkspaceSidebar
          projects={bootstrap?.projects ?? []}
          projectId={projectId}
          runs={projectQuery.data?.runs ?? []}
          runId={ui.runId}
          tab={ui.tab}
          open={sidebarOpen}
          connected={connection === "connected"}
          onProjectChange={onProjectChange}
          onAction={action}
        />
      }
    >
      <ErrorNotice
        title="Connection unavailable"
        error={bootstrapError}
        onRetry={onRetryBootstrap}
      />
      {needsAuth && <AuthPanel />}
      <ErrorNotice
        title="Project could not load"
        error={projectQuery.error}
        onRetry={() => void projectQuery.refetch()}
      />
      <ResearchComposer
        projectId={projectId}
        collections={projectQuery.data?.collections ?? []}
        collectionId={collectionId}
        examples={bootstrap?.examples ?? []}
        liveEnabled={bootstrap?.live_enabled ?? false}
        running={running}
        onCollectionChange={(id) =>
          dispatch({ type: "select-collection", collectionId: id })
        }
        onStarted={(id) => dispatch({ type: "started-run", runId: id })}
      />
      <ErrorNotice
        title="Saved run could not load"
        error={runQuery.error}
        onRetry={() => void runQuery.refetch()}
      />
      {!!ui.runId && runQuery.isPending && (
        <p role="status">Loading saved run…</p>
      )}
      {run && (
        <RunStrip
          key={`summary-${run.id}`}
          projectId={projectId}
          run={run}
          evidenceCount={runQuery.data?.detail.evidence.length ?? 0}
        />
      )}
      {run?.status === "awaiting_approval" && run.plan && (
        <PlanReview
          key={`plan-${run.id}`}
          projectId={projectId}
          runId={run.id}
          initialPlan={run.plan}
          onApproved={() => dispatch({ type: "navigate", tab: "activity" })}
        />
      )}
      <RunViews
        key={`views-${ui.runId}`}
        projectId={projectId}
        collectionId={collectionId}
        readOnly={collection?.read_only ?? false}
        evaluationsEnabled={bootstrap?.evaluations_enabled ?? false}
        snapshot={runQuery.data}
        tab={ui.tab}
        onNavigate={(tab) => dispatch({ type: "navigate", tab })}
        onEvidence={(item) =>
          dispatch({
            type: "show-overlay",
            overlay: item ? { kind: "evidence", evidenceId: item.id } : null,
          })
        }
        onCreateCollection={() =>
          dispatch({
            type: "show-overlay",
            overlay: { kind: "create-collection" },
          })
        }
      />
      <footer className="workspace-footer">
        <span>
          Evidence Workbench <span className="footer-divider">/</span> v0.1.0
        </span>
        <span>
          {run
            ? "*Tokens: conservative reservations; actual usage when reported."
            : "Trace the evidence. Keep the uncertainty."}
        </span>
      </footer>
      {evidence && (
        <EvidenceDrawer evidence={evidence} onClose={closeOverlay} />
      )}
      {overlay?.kind === "create-project" && (
        <CreateDialog
          kind="project"
          onClose={closeOverlay}
          onCreated={onProjectChange}
        />
      )}
      {overlay?.kind === "create-collection" && (
        <CreateDialog
          kind="collection"
          projectId={projectId}
          liveEnabled={bootstrap?.live_enabled ?? false}
          onClose={closeOverlay}
          onCreated={(id) => {
            dispatch({ type: "select-collection", collectionId: id });
            dispatch({ type: "navigate", tab: "sources" });
          }}
        />
      )}
    </WorkspaceFrame>
  );
}
