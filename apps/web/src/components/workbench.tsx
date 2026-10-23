"use client";

import { useReducer, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ErrorNotice } from "./error-notice";
import { initialHarnessConfiguration } from "@/features/harness/configuration";
import {
  initialResearchDraft,
  researchReducer,
} from "@/features/workbench/research-state";
import { modelCatalogOptions } from "@/features/harness/queries";
import { ApiError } from "@/lib/api";
import type { Bootstrap, Project } from "@/lib/contracts";
import { AuthPanel } from "@/features/workbench/auth-panel";
import { CreateDialog } from "@/features/workbench/create-dialog";
import { EvidenceDrawer } from "@/features/workbench/evidence-drawer";
import { PlanReview } from "@/features/workbench/plan-review";
import { InvestigationHeader } from "@/features/workbench/investigation-header";
import { ResearchComposer } from "@/features/workbench/research-composer";
import { RunStrip } from "@/features/workbench/run-strip";
import { RunViews } from "@/features/workbench/run-views";
import { HarnessView } from "@/features/workbench/harness-view";
import { RagWorkspace } from "@/features/collections/rag-workspace";
import { CollectionWizard } from "@/features/collections/collection-wizard";
import { useUploadQueue } from "@/features/collections/use-upload-queue";
import { EvaluationsView } from "./evaluations-view";
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
  const [selectedModelId, setSelectedModelId] = useState("");
  const [judgeModelId, setJudgeModelId] = useState("");
  const modelsEnabled = bootstrap?.model_catalog_enabled ?? false;
  const models = useQuery(
    modelCatalogOptions(
      projectId,
      modelsEnabled &&
        (ui.workspace === "harness" ||
          ui.workspace === "workflows" ||
          ui.workspace === "evaluations"),
    ),
  );
  const defaultModel = models.data?.default_model ?? "";
  const modelId =
    selectedModelId ||
    (models.data?.models.includes(defaultModel) ? defaultModel : "");
  const modelSelection = modelsEnabled
    ? {
        catalog: models.data,
        fetching: models.isFetching,
        error: models.error,
        modelId,
        onModelChange: setSelectedModelId,
        onRefresh: () => {
          void models.refetch();
        },
      }
    : undefined;
  const [configuration, setConfiguration] = useState(
    initialHarnessConfiguration,
  );
  const [researchDraft, researchDispatch] = useReducer(
    researchReducer,
    initialResearchDraft,
  );
  const research = { draft: researchDraft, dispatch: researchDispatch };
  const uploads = useUploadQueue(projectId);
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
          pending={connection === "connecting"}
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
        <div hidden={!!ui.runId}>
          <ResearchComposer
            research={research}
            configuration={configuration}
            modelSelection={modelSelection}
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
        </div>
        {run && (
          <InvestigationHeader
            run={run}
            collectionName={
              projectQuery.data?.collections.find(
                (c) => c.id === run.collection_id,
              )?.name ??
              collection?.name ??
              "Evidence collection"
            }
            evidenceCount={runQuery.data?.detail.evidence.length ?? 0}
            onNavigate={(tab) => dispatch({ type: "navigate", tab })}
          />
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
            onApproved={() => dispatch({ type: "navigate", tab: "execution" })}
          />
        )}
        <RunViews
          strategy={researchDraft.strategy}
          onStrategyChange={(value) =>
            researchDispatch({ type: "strategy", value })
          }
          onHarness={() =>
            dispatch({ type: "workspace", workspace: "harness" })
          }
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
          onApplyPreset={(preset) => {
            setConfiguration(preset.configuration);
            setSelectedModelId(preset.model_id ?? "");
            setJudgeModelId(preset.judge_model_id ?? "");
            researchDispatch({ type: "limits", value: preset.limits });
          }}
          judgeSelection={{ modelId: judgeModelId, onChange: setJudgeModelId }}
          projectId={projectId}
          active={ui.workspace === "harness"}
          research={research}
          configuration={configuration}
          onConfigurationChange={setConfiguration}
          onOpenWorkflows={() =>
            dispatch({ type: "workspace", workspace: "workflows" })
          }
          modelSelection={modelSelection}
          snapshot={runQuery.data}
          liveEnabled={bootstrap?.live_enabled ?? false}
        />
      </section>
      <section hidden={ui.workspace !== "rag"} aria-label="RAG workspace">
        <RagWorkspace
          projectId={projectId}
          collections={projectQuery.data?.collections ?? []}
          collectionId={collectionId}
          active={ui.workspace === "rag"}
          uploads={uploads}
          onSelect={(id) =>
            dispatch({ type: "select-collection", collectionId: id })
          }
          onCreate={() =>
            dispatch({
              type: "show-overlay",
              overlay: { kind: "create-collection" },
            })
          }
        />
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
          onOpenRun={(runId) => {
            dispatch({ type: "select-run", runId });
            document.getElementById("workspace")?.focus();
          }}
          setup={{
            collections: projectQuery.data?.collections ?? [],
            collectionId,
            onCollectionChange: (id) =>
              dispatch({ type: "select-collection", collectionId: id }),
            examples: bootstrap?.examples ?? [],
            liveEnabled: bootstrap?.live_enabled ?? false,
            modelId,
            judgeModelId,
            judgePricesKnown:
              !!models.data?.judge_pricing_configured &&
              judgeModelId === models.data.default_model,
            configuration,
            limits: researchDraft.limits,
          }}
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
        <CollectionWizard
          projectId={projectId}
          collections={projectQuery.data?.collections ?? []}
          uploads={uploads}
          onClose={closeOverlay}
          onFinished={(id) => {
            dispatch({ type: "select-collection", collectionId: id });
            dispatch({ type: "workspace", workspace: "rag" });
          }}
        />
      )}
    </WorkspaceFrame>
  );
}
