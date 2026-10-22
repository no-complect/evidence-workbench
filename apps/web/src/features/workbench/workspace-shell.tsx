import type { ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  Database,
  FlaskConical,
  FolderClosed,
  Layers3,
  Menu,
  Plus,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Project, RunListItem } from "@/lib/contracts";
import type { WorkspaceAction, WorkspaceTab } from "./workspace-state";

export function WorkspaceSidebar({
  projects,
  projectId,
  runs,
  runId,
  tab,
  open,
  connected,
  onProjectChange,
  onAction,
}: {
  projects: Project[];
  projectId: string;
  runs: RunListItem[];
  runId: string;
  tab: WorkspaceTab;
  open: boolean;
  connected: boolean;
  onProjectChange: (id: string) => void;
  onAction: (action: WorkspaceAction) => void;
}) {
  return (
    <aside
      id="workspace-navigation"
      className={`sidebar ${open ? "sidebar-open" : ""}`}
    >
      <a className="brand" href="/" aria-label="Evidence home">
        <span className="brand-mark">
          <Layers3 size={23} />
        </span>
        <span>
          evidence<span className="brand-period">.</span>
        </span>
      </a>
      <div className="workspace-label">
        RESEARCH WORKBENCH <span>01</span>
      </div>
      <label className="sr-only" htmlFor="project">
        Project
      </label>
      <div className="project-select">
        <FolderClosed size={17} />
        <select
          id="project"
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
        <ChevronDown size={14} />
      </div>
      <Button
        variant="ghost"
        className="sidebar-add"
        onClick={() =>
          onAction({
            type: "show-overlay",
            overlay: { kind: "create-project" },
          })
        }
        disabled={!connected}
      >
        <Plus size={15} />
        New project
      </Button>
      <div className="nav-heading">WORKSPACE</div>
      <button
        type="button"
        className={`nav-item ${!["sources", "evaluations"].includes(tab) ? "active" : ""}`}
        onClick={() => onAction({ type: "navigate", tab: "report" })}
      >
        <Search size={18} />
        Investigations<span className="nav-count">{runs.length}</span>
      </button>
      <button
        type="button"
        className={`nav-item ${tab === "sources" ? "active" : ""}`}
        onClick={() => onAction({ type: "navigate", tab: "sources" })}
      >
        <Database size={18} />
        Collections
      </button>
      <button
        type="button"
        className={`nav-item ${tab === "evaluations" ? "active" : ""}`}
        onClick={() => onAction({ type: "navigate", tab: "evaluations" })}
      >
        <FlaskConical size={18} />
        Evaluations
      </button>
      <div className="nav-heading recent-label">
        RECENT RESEARCH
        <button
          type="button"
          aria-label="New investigation"
          onClick={() => onAction({ type: "new-investigation" })}
        >
          <Plus size={15} />
        </button>
      </div>
      <div className="recent-runs">
        {runs.length === 0 ? (
          <p className="sidebar-empty">Your investigations will appear here.</p>
        ) : (
          runs.map((run) => (
            <button
              type="button"
              key={run.id}
              className={`recent-run ${runId === run.id ? "selected" : ""}`}
              onClick={() => onAction({ type: "select-run", runId: run.id })}
            >
              <span className={`run-dot ${run.status}`} />
              <span>{run.question}</span>
            </button>
          ))
        )}
      </div>
      <div className="sidebar-bottom">
        <ShieldCheck size={18} />
        <div>
          <strong>
            {process.env.NEXT_PUBLIC_AUTH_MODE === "supabase"
              ? "Private workspace"
              : "Local demo workspace"}
          </strong>
          <span>
            {process.env.NEXT_PUBLIC_AUTH_MODE === "supabase"
              ? "Project-scoped access"
              : "No API credentials needed"}
          </span>
        </div>
      </div>
    </aside>
  );
}

export function WorkspaceFrame({
  navigation,
  projectName,
  connection,
  menuOpen,
  onToggleMenu,
  children,
}: {
  navigation: ReactNode;
  projectName: string;
  connection: "connecting" | "connected" | "offline";
  menuOpen: boolean;
  onToggleMenu: () => void;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      {navigation}
      <div className="main-shell">
        <header className="topbar">
          <button
            type="button"
            className="mobile-menu"
            aria-label="Toggle navigation"
            aria-expanded={menuOpen}
            aria-controls="workspace-navigation"
            onClick={onToggleMenu}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            Workspace
            <ChevronRight size={14} />
            <span>{projectName}</span>
          </div>
          <div className="topbar-right">
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
            <span className="avatar" aria-label="Research workspace">
              EW
            </span>
          </div>
        </header>
        <main id="workspace">{children}</main>
      </div>
    </div>
  );
}
