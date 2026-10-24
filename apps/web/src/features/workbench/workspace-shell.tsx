import type { ReactNode } from "react";
import {
  Braces,
  Database,
  FlaskConical,
  Plus,
  ScanLine,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { Project, RunListItem } from "@/lib/contracts";
import type { EngineeringWorkspace, WorkspaceAction } from "./workspace-state";
import styles from "./notebook.module.css";

const workspaces = [
  {
    id: "harness",
    label: "Harness",
    icon: Braces,
    help: "Configure instructions, context policy, models and output contracts for future runs. Editing these settings makes no model calls.",
  },
  {
    id: "rag",
    label: "RAG",
    icon: Database,
    help: "Prepare source collections and test retrieval before asking a model to synthesize an answer.",
  },
  {
    id: "workflows",
    label: "Workflows",
    icon: Workflow,
    help: "Run an investigation and inspect its plan, execution, evidence, report and assembled context.",
  },
  {
    id: "evaluations",
    label: "Evaluations",
    icon: FlaskConical,
    help: "Compare RAG, fixed workflow and bounded research using frozen sources and expectations.",
  },
] as const;

export function WorkspaceNavigation({
  workspace,
  onChange,
  pending = false,
}: {
  workspace: EngineeringWorkspace;
  onChange: (workspace: EngineeringWorkspace) => void;
  pending?: boolean;
}) {
  return (
    <nav className={styles.navigation} aria-label="Engineering workspaces">
      {workspaces.map(({ id, label, icon: Icon, help }) => (
        <Tooltip key={id} content={help}>
          <button
            type="button"
            aria-pressed={workspace === id}
            disabled={pending}
            onClick={() => onChange(id)}
          >
            <Icon size={17} />
            {label}
          </button>
        </Tooltip>
      ))}
      <span className={styles.navNote}>INSPECT / EXPERIMENT / EVALUATE</span>
    </nav>
  );
}

export function ProjectBar({
  projects,
  projectId,
  runs,
  runId,
  connected,
  onProjectChange,
  onAction,
}: {
  projects: Project[];
  projectId: string;
  runs: RunListItem[];
  runId: string;
  connected: boolean;
  onProjectChange: (id: string) => void;
  onAction: (action: WorkspaceAction) => void;
}) {
  return (
    <div className={styles.projectBar}>
      <div className={styles.projectControls}>
        <label>
          Project
          <select
            value={projectId}
            onChange={(event) => onProjectChange(event.target.value)}
          >
            <option value="" disabled>
              Select a project
            </option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          help="Create a separate project with its own collections, investigations and evaluation history."
          variant="ghost"
          size="sm"
          disabled={!connected}
          onClick={() =>
            onAction({
              type: "show-overlay",
              overlay: { kind: "create-project" },
            })
          }
        >
          <Plus size={14} />
          New project
        </Button>
      </div>
      <div className={styles.projectControls}>
        <label>
          Saved investigation
          <select
            value={runId}
            onChange={(event) =>
              onAction(
                event.target.value
                  ? { type: "select-run", runId: event.target.value }
                  : { type: "new-investigation" },
              )
            }
          >
            <option value="">New investigation</option>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {run.question.slice(0, 80)} · {run.status.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <Button
          help="Start a new draft without deleting the selected saved investigation."
          variant="ghost"
          size="sm"
          onClick={() => onAction({ type: "new-investigation" })}
        >
          <Plus size={14} />
          New investigation
        </Button>
      </div>
    </div>
  );
}

export function WorkspaceFrame({
  navigation,
  projectBar,
  connection,
  account,
  children,
}: {
  navigation: ReactNode;
  projectBar: ReactNode;
  connection: "connecting" | "connected" | "offline";
  account?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <header className={styles.header}>
        <a href="/" className={styles.brand}>
          <span>
            <ScanLine size={22} />
          </span>
          Evidence Workbench
        </a>
        <div className={styles.headerAside}>
          <span className={styles.tagline}>Inspect. Experiment. Evaluate.</span>
          <span
            className={`connection ${connection === "connected" ? "online" : ""}`}
          >
            <span />
            {connection === "connecting"
              ? "Connecting"
              : connection === "connected"
                ? "Connected"
                : "Offline"}
          </span>
        </div>
      </header>
      {account}
      {navigation}
      <main id="workspace" className={styles.main}>
        {projectBar}
        {children}
      </main>
    </div>
  );
}

export function WorkspaceHeading({
  kicker,
  title,
  children,
  action,
}: {
  kicker: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={styles.heading}>
      <div>
        <div className="eyebrow">{kicker}</div>
        <h1>{title}</h1>
        <p>{children}</p>
      </div>
      {action}
    </div>
  );
}
