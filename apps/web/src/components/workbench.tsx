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
import { HarnessView } from "@/features/workbench/harness-view";
import { SourcesPanel } from "@/features/workbench/sources-panel";
import { EvaluationsView } from "./evaluations-view";
import notebook from "@/features/workbench/notebook.module.css";
import {
  WorkspaceFrame,
  WorkspaceNavigation,
  WorkspaceHeading,
  ProjectBar,
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
  const action = (next: WorkspaceAction) => dispatch(next);
  const closeOverlay = () => dispatch({ type: "show-overlay", overlay: null });
  return (
    <WorkspaceFrame
      connection={connection}
      navigation={
        <WorkspaceNavigation
          workspace={ui.workspace}
          onChange={(workspace) => action({ type: "workspace", workspace })}
        />
      }
      projectBar={
        <ProjectBar
          projects={bootstrap?.projects ?? []}
          projectId={projectId}
          runs={projectQuery.data?.runs ?? []}
          runId={ui.runId}
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
      <ErrorNotice
        title="Saved run could not load"
        error={runQuery.error}
        onRetry={() => void runQuery.refetch()}
      />
      {!!ui.runId && runQuery.isPending && (
        <p role="status">Loading saved run…</p>
      )}
      <section
        hidden={ui.workspace !== "workflows"}
        aria-label="Workflows workspace"
      >
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
          snapshot={runQuery.data}
          tab={ui.tab}
          onNavigate={(tab) => dispatch({ type: "navigate", tab })}
          onEvidence={(item) =>
            dispatch({
              type: "show-overlay",
              overlay: item ? { kind: "evidence", evidenceId: item.id } : null,
            })
          }
        />
      </section>
      <section
        hidden={ui.workspace !== "harness"}
        aria-label="Harness workspace"
      >
        <HarnessView
          snapshot={runQuery.data}
          liveEnabled={bootstrap?.live_enabled ?? false}
        />
      </section>
      <section hidden={ui.workspace !== "rag"} aria-label="RAG workspace">
        <WorkspaceHeading
          kicker="RAG / COLLECTIONS & SOURCES"
          title="Give the answer a foundation."
        >
          Bring the documents behind a decision. Inspect ingestion and source
          versions before investigating.
        </WorkspaceHeading>
        <div className={notebook.note}>
          Requirements, architecture notes, policies, runbooks, and cost
          assumptions make useful sources. Markdown, text, and text-based PDF
          files are supported, up to 8 MiB per file.
        </div>
        <label className={notebook.collectionControl}>
          Collection
          <select
            aria-label="RAG collection"
            value={collectionId}
            onChange={(event) =>
              dispatch({
                type: "select-collection",
                collectionId: event.target.value,
              })
            }
          >
            <option value="" disabled>
              Select a collection
            </option>
            {(projectQuery.data?.collections ?? []).map((item) => (
              <option value={item.id} key={item.id}>
                {item.name} · {item.document_count} docs
              </option>
            ))}
          </select>
        </label>
        <div className={notebook.surface}>
          <div className={notebook.pad}>
            <SourcesPanel
              key={collectionId}
              projectId={projectId}
              collectionId={collectionId}
              readOnly={collection?.read_only ?? false}
              active={ui.workspace === "rag"}
              onCreate={() =>
                dispatch({
                  type: "show-overlay",
                  overlay: { kind: "create-collection" },
                })
              }
            />
          </div>
        </div>
      </section>
      <section
        hidden={ui.workspace !== "evaluations"}
        aria-label="Evaluations workspace"
      >
        <WorkspaceHeading
          kicker="EVALUATIONS / MEASURE & COMPARE"
          title="Put the configuration to the test."
        >
          Compare strategies against a fixed corpus and explicit expectations.
          Inspect individual cases as carefully as aggregate results.
        </WorkspaceHeading>
        <EvaluationsView
          projectId={projectId}
          enabled={bootstrap?.evaluations_enabled ?? false}
          active={ui.workspace === "evaluations"}
        />
      </section>
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
            dispatch({ type: "workspace", workspace: "rag" });
          }}
        />
      )}
    </WorkspaceFrame>
  );
}
