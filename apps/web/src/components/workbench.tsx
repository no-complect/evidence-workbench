"use client";
import { EvaluationsView } from "./evaluations-view";
import { SourcesView } from "./sources-view";
import { ContextView } from "./context-view";
import { ActivityView } from "./activity-view";
import { EvidenceView } from "./evidence-view";
import { ReportView } from "./report-view";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Database,
  FileText,
  FlaskConical,
  FolderClosed,
  Layers3,
  Loader2,
  Menu,
  PanelRightClose,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  api,
  exportReport,
  type Project,
  type Collection,
  type Run,
  type Detail,
  type Evidence,
  type RunEvent,
  type Source,
  type Evaluation,
  type Plan,
  type Limits,
} from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { RunCreate } from "../../../../packages/contracts/models";

const DEFAULT_QUESTION =
  "Compare three approaches to deploying an enterprise AI assistant. Investigate security, operating costs, retrieval quality, and maintenance. Support recommendations with evidence and identify unresolved questions.";
const limitsDefault: Limits = {
  iterations: 2,
  tool_calls: 24,
  tokens: 48000,
  wall_seconds: 120,
  concurrency: 1,
  estimated_cost_usd: 1,
  top_k: 5,
};
const terminal = new Set(["completed", "partial", "failed", "cancelled"]);
type Tab =
  "report" | "evidence" | "activity" | "context" | "sources" | "evaluations";
const tabs = [
  { id: "report", label: "Report", icon: FileText },
  { id: "evidence", label: "Evidence", icon: BookOpen },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "context", label: "Context", icon: Layers3 },
  { id: "sources", label: "Sources", icon: Database },
  { id: "evaluations", label: "Evaluations", icon: FlaskConical },
] as const;
const statusLabel = (s: string) => s.replaceAll("_", " ");
export function Workbench() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionId, setCollectionId] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [examples, setExamples] = useState<string[]>([DEFAULT_QUESTION]);
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [strategy, setStrategy] = useState<"agent" | "rag" | "workflow">(
    "agent",
  );
  const [limits, setLimits] = useState(limitsDefault);
  const [approval, setApproval] = useState(true);
  const [webEnabled, setWebEnabled] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [runId, setRunId] = useState("");
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [tab, setTab] = useState<Tab>("report");
  const [selectedEvidence, setSelectedEvidence] = useState<Evidence | null>(
    null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [dialog, setDialog] = useState<"project" | "collection" | null>(null);
  const [newName, setNewName] = useState("");
  const [email, setEmail] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [needsAuth, setNeedsAuth] = useState(false);
  const activeProject = useRef(projectId);
  activeProject.current = projectId;
  const epoch = useRef(0);
  const run = detail?.run;
  const running =
    !!run && !terminal.has(run.status) && run.status !== "awaiting_approval";
  const project = projects.find((p) => p.id === projectId);

  useEffect(() => {
    if (!dialog && !selectedEvidence) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = document.querySelector<HTMLElement>("[role=dialog]");
    const focusable = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, a[href], select, textarea, [tabindex="0"]',
        ) || [],
      );
    focusable()[0]?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDialog(null);
        setSelectedEvidence(null);
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("keydown", keyboard);
      previous?.focus();
    };
  }, [dialog, selectedEvidence]);

  const handle = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }, []);
  const loadBootstrap = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{
        projects: Project[];
        examples: string[];
        live_enabled: boolean;
      }>("bootstrap");
      const client = supabase();
      if (client && process.env.NEXT_PUBLIC_AUTH_MODE === "supabase") {
        const { data: authorized, error: dbError } = await client
          .from("projects")
          .select("id,name");
        if (dbError) throw dbError;
        data.projects = authorized as Project[];
      }
      setProjects(data.projects);
      setExamples(data.examples);
      setLiveEnabled(data.live_enabled);
      setProjectId((current) => current || data.projects[0]?.id || "");
      setConnected(true);
      setError("");
      setNeedsAuth(false);
    } catch (e) {
      setConnected(false);
      setError(e instanceof Error ? e.message : "Connection failed");
      setNeedsAuth(process.env.NEXT_PUBLIC_AUTH_MODE === "supabase");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadBootstrap();
    const client = supabase();
    const subscription = client?.auth.onAuthStateChange(() => {
      void loadBootstrap();
    });
    return () => subscription?.data.subscription.unsubscribe();
  }, [loadBootstrap]);
  const loadProject = useCallback(async () => {
    if (!projectId) return;
    const result = await api<{ collections: Collection[]; runs: Run[] }>(
      `projects/${projectId}`,
    );
    if (activeProject.current !== projectId) return;
    setCollections(result.collections);
    setRuns(result.runs);
    setCollectionId((current) =>
      result.collections.some((c) => c.id === current)
        ? current
        : result.collections[0]?.id || "",
    );
  }, [projectId]);
  useEffect(() => {
    let alive = true;
    setRunId("");
    setDetail(null);
    setEvents([]);
    setSelectedEvidence(null);
    setCollections([]);
    setRuns([]);
    setCollectionId("");
    if (projectId)
      api<{ collections: Collection[]; runs: Run[] }>(`projects/${projectId}`)
        .then((data) => {
          if (!alive) return;
          setCollections(data.collections);
          setRuns(data.runs);
          setCollectionId(data.collections[0]?.id || "");
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    return () => {
      alive = false;
    };
  }, [projectId]);
  useEffect(() => {
    let alive = true;
    setSources([]);
    if (projectId && collectionId)
      api<Source[]>(`projects/${projectId}/collections/${collectionId}/sources`)
        .then((data) => {
          if (alive) setSources(data);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    return () => {
      alive = false;
    };
  }, [projectId, collectionId]);
  useEffect(() => {
    if (!projectId || tab !== "evaluations") return;
    let alive = true;
    api<Evaluation[]>(`projects/${projectId}/evaluations`)
      .then((data) => {
        if (alive) setEvaluations(data);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [projectId, tab]);
  useEffect(() => {
    if (!runId || !projectId) return;
    const current = ++epoch.current;
    let cursor = 0;
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    setEvents([]);
    setDetail(null);
    setSelectedEvidence(null);
    setPlan(null);
    const poll = async () => {
      let delay = 1100;
      try {
        const [next, activity] = await Promise.all([
          api<Detail>(`projects/${projectId}/runs/${runId}`),
          api<{ events: RunEvent[]; cursor: number }>(
            `projects/${projectId}/runs/${runId}/events?after=${cursor}`,
          ),
        ]);
        if (!alive || current !== epoch.current) return;
        setDetail(next);
        setConnected(true);
        setEvents((previous) =>
          [
            ...previous,
            ...activity.events.filter(
              (e) => !previous.some((p) => p.id === e.id),
            ),
          ].sort((a, b) => a.id - b.id),
        );
        cursor = activity.cursor;
        setPlan((previous) => previous || next.run.plan);
        if (terminal.has(next.run.status)) {
          void loadProject();
          return;
        }
        if (next.run.status === "awaiting_approval") delay = 2500;
      } catch (e) {
        if (!alive) return;
        setConnected(false);
        setError(
          e instanceof Error ? e.message : "Reconnecting to saved progress…",
        );
        delay = 4000;
      }
      if (alive) timer = setTimeout(poll, delay);
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [projectId, runId, loadProject]);

  const start = () =>
    handle(async () => {
      const body: RunCreate = {
        question,
        collection_id: collectionId,
        mode,
        strategy,
        limits,
        approve_plan: approval,
        web_enabled: webEnabled && mode === "live",
        idempotency_key: crypto.randomUUID(),
      };
      const next = await api<Run>(`projects/${projectId}/runs`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setRunId(next.id);
      setTab("activity");
      await loadProject();
    });
  const approve = () =>
    handle(async () => {
      await api(`projects/${projectId}/runs/${runId}/approve`, {
        method: "POST",
        body: JSON.stringify(plan),
      });
      setPlan(null);
      setTab("activity");
    });
  const cancel = () =>
    handle(async () => {
      await api(`projects/${projectId}/runs/${runId}/cancel`, {
        method: "POST",
      });
    });
  const create = () =>
    handle(async () => {
      if (dialog === "project") {
        const p = await api<Project>("projects", {
          method: "POST",
          body: JSON.stringify({ name: newName }),
        });
        setProjects((old) => [...old, p]);
        setProjectId(p.id);
      } else {
        const c = await api<Collection>(`projects/${projectId}/collections`, {
          method: "POST",
          body: JSON.stringify({
            name: newName,
            embedding_config: mode === "live" ? "openai-small-v1" : "demo-v1",
          }),
        });
        await loadProject();
        setCollectionId(c.id);
      }
      setDialog(null);
      setNewName("");
    });
  const upload = (file: File) =>
    handle(async () => {
      if (file.size > 8 * 1024 * 1024)
        throw new Error("Files must be 8 MiB or smaller");
      const form = new FormData();
      form.append("file", file);
      await api(`projects/${projectId}/collections/${collectionId}/sources`, {
        method: "POST",
        body: form,
      });
      setSources(
        await api<Source[]>(
          `projects/${projectId}/collections/${collectionId}/sources`,
        ),
      );
      await loadProject();
      setTab("sources");
    });
  const evidence = detail?.evidence || [];

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <aside className={`sidebar ${sidebar ? "sidebar-open" : ""}`}>
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
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="" disabled>
              Select a project
            </option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </div>
        <Button
          variant="ghost"
          className="sidebar-add"
          onClick={() => setDialog("project")}
          disabled={!connected}
        >
          <Plus size={15} /> New project
        </Button>
        <div className="nav-heading">WORKSPACE</div>
        <button
          className={`nav-item ${!["sources", "evaluations"].includes(tab) ? "active" : ""}`}
          onClick={() => {
            setTab("report");
            setSidebar(false);
          }}
        >
          <Search size={18} /> Investigations{" "}
          <span className="nav-count">{runs.length}</span>
        </button>
        <button
          className={`nav-item ${tab === "sources" ? "active" : ""}`}
          onClick={() => {
            setTab("sources");
            setSidebar(false);
          }}
        >
          <Database size={18} /> Collections
        </button>
        <button
          className={`nav-item ${tab === "evaluations" ? "active" : ""}`}
          onClick={() => {
            setTab("evaluations");
            setSidebar(false);
          }}
        >
          <FlaskConical size={18} /> Evaluations
        </button>
        <div className="nav-heading recent-label">
          RECENT RESEARCH{" "}
          <button
            aria-label="New investigation"
            onClick={() => {
              setRunId("");
              setDetail(null);
              setTab("report");
            }}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="recent-runs">
          {runs.length === 0 ? (
            <p className="sidebar-empty">
              Your investigations will appear here.
            </p>
          ) : (
            runs.map((r) => (
              <button
                key={r.id}
                className={`recent-run ${runId === r.id ? "selected" : ""}`}
                onClick={() => {
                  setRunId(r.id);
                  setTab("report");
                  setSidebar(false);
                }}
              >
                <span className={`run-dot ${r.status}`} />
                <span>{r.question}</span>
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
      <div className="main-shell">
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-label="Toggle navigation"
            onClick={() => setSidebar(!sidebar)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <span>{project?.name || "Research"}</span>
          </div>
          <div className="topbar-right">
            <span className={`connection ${connected ? "online" : ""}`}>
              <span />
              {loading ? "Connecting" : connected ? "Connected" : "Offline"}
            </span>
            <span className="avatar" aria-label="Research workspace">
              EW
            </span>
          </div>
        </header>
        <main id="workspace">
          <div className="page-heading">
            <div>
              <div className="eyebrow">ASK. INVESTIGATE. VERIFY.</div>
              <h1>Research workspace</h1>
              <p>Decisions grounded in sources you can inspect.</p>
            </div>
            <span className={`mode-badge ${mode}`}>
              <span />
              {mode === "demo" ? "SCRIPTED DEMO" : "LIVE INFERENCE"}
            </span>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <div>
                <strong>
                  {connected
                    ? "Action could not complete"
                    : "Connection unavailable"}
                </strong>
                <p>{error}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void loadBootstrap()}
              >
                Reconnect
              </Button>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={17} />
              </button>
            </div>
          )}
          {needsAuth && (
            <form
              className="auth-panel"
              onSubmit={(e) => {
                e.preventDefault();
                void handle(async () => {
                  const client = supabase();
                  if (!client)
                    throw new Error(
                      "Supabase browser configuration is missing",
                    );
                  const { error: authError } = await client.auth.signInWithOtp({
                    email,
                    options: { emailRedirectTo: window.location.origin },
                  });
                  if (authError) throw authError;
                  setAuthMessage("Check your email for a sign-in link.");
                });
              }}
            >
              <label htmlFor="email">Sign in to your research workspace</label>
              <div className="flex-row">
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
                <Button disabled={busy}>Send sign-in link</Button>
              </div>
              <p role="status">{authMessage}</p>
            </form>
          )}
          <section className="composer" aria-labelledby="composer-title">
            <div className="composer-label">
              <span>
                <Sparkles size={16} />
                <label id="composer-title" htmlFor="question">
                  What would you like to investigate?
                </label>
              </span>
              <span className="mono">NEW INVESTIGATION</span>
            </div>
            <textarea
              id="question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={3}
              maxLength={4000}
            />
            <div className="example-row">
              <span>Try an example</span>
              {examples.slice(1, 4).map((q, i) => (
                <button key={q} onClick={() => setQuestion(q)}>
                  {
                    [
                      "Security requirements",
                      "Operating costs",
                      "Conflicting evidence",
                    ][i]
                  }
                </button>
              ))}
              <button onClick={() => setQuestion(DEFAULT_QUESTION)}>
                Full comparison
              </button>
            </div>
            <div className="composer-toolbar">
              <div className="composer-selects">
                <label>
                  <Database size={15} />
                  <span className="sr-only">Collection</span>
                  <select
                    value={collectionId}
                    onChange={(e) => setCollectionId(e.target.value)}
                  >
                    <option value="" disabled>
                      Select a collection
                    </option>
                    {collections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.document_count} docs
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className={`settings-toggle ${showSettings ? "selected" : ""}`}
                  onClick={() => setShowSettings(!showSettings)}
                  aria-expanded={showSettings}
                >
                  <Settings2 size={16} /> Research settings
                </button>
              </div>
              <Button
                onClick={start}
                disabled={
                  busy || !collectionId || question.length < 10 || running
                }
              >
                {busy ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <Search size={16} />
                )}
                Start research
              </Button>
            </div>
            {showSettings && (
              <div className="settings-grid">
                <label>
                  Execution mode
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as "demo" | "live")}
                  >
                    <option value="demo">Scripted demo · no paid calls</option>
                    <option value="live" disabled={!liveEnabled}>
                      Live · {liveEnabled ? "configured" : "not configured"}
                    </option>
                  </select>
                </label>
                <label>
                  Research strategy
                  <select
                    value={strategy}
                    onChange={(e) =>
                      setStrategy(e.target.value as typeof strategy)
                    }
                  >
                    <option value="agent">Bounded research</option>
                    <option value="workflow">Fixed workflow</option>
                    <option value="rag">Basic RAG</option>
                  </select>
                </label>
                {(
                  [
                    ["iterations", "Max iterations", 1, 5],
                    ["tool_calls", "Tool calls", 1, 100],
                    ["concurrency", "Researchers", 1, 3],
                    ["top_k", "Results per search", 1, 20],
                    ["tokens", "Token budget", 500, 200000],
                    ["wall_seconds", "Execution seconds", 5, 900],
                    ["estimated_cost_usd", "Estimated cost cap · USD", 0, 25],
                  ] as const
                ).map(([key, label, min, max]) => (
                  <label key={key}>
                    {label}
                    <input
                      type="number"
                      min={min}
                      max={max}
                      step={key === "estimated_cost_usd" ? 0.01 : 1}
                      value={limits[key]}
                      onChange={(e) =>
                        setLimits((old) => ({
                          ...old,
                          [key]: Number(e.target.value),
                        }))
                      }
                    />
                  </label>
                ))}
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={approval}
                    onChange={(e) => setApproval(e.target.checked)}
                  />{" "}
                  Review plan before research
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={webEnabled && mode === "live"}
                    disabled={mode === "demo"}
                    onChange={(e) => setWebEnabled(e.target.checked)}
                  />{" "}
                  Include public web sources
                </label>
              </div>
            )}
          </section>
          <div className="demo-note">
            <CircleDot size={14} />
            <span>
              {mode === "demo"
                ? "Synthetic documents. Scripted responses. Real retrieval, citations, and persisted execution."
                : "Live model calls use server credentials and your configured budget. Costs are estimates."}
            </span>
            <span className="note-version">CORPUS v1</span>
          </div>
          {run && (
            <section className="run-strip" aria-live="polite">
              <div>
                <span className={`status-badge ${run.status}`}>
                  {running && <Loader2 size={13} className="spin" />}
                  {statusLabel(run.status)}
                </span>
                <span className="run-short mono">{run.id.slice(0, 8)}</span>
              </div>
              <div className="run-metrics">
                <span>
                  <BookOpen size={14} />
                  {evidence.length} passages
                </span>
                <span>
                  <Activity size={14} />
                  {run.tools_used} calls
                </span>
                <span>{run.tokens_used.toLocaleString()} tokens*</span>
                <span>${Number(run.cost_used).toFixed(4)} est.</span>
                {!terminal.has(run.status) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={cancel}
                    disabled={busy || run.cancel_requested}
                  >
                    <Square size={12} />
                    {run.cancel_requested ? "Cancelling" : "Cancel"}
                  </Button>
                )}
              </div>
            </section>
          )}
          {run?.status === "awaiting_approval" && plan && (
            <section className="plan-panel">
              <div className="section-title">
                <div>
                  <span className="eyebrow">YOUR REVIEW</span>
                  <h2>A plan before we proceed</h2>
                </div>
                <span className="status-badge awaiting_approval">
                  Approval required
                </span>
              </div>
              <p>{plan.rationale}</p>
              <div className="plan-tasks">
                {plan.tasks.map((task, index) => (
                  <label key={task.id}>
                    <span className="task-number">0{index + 1}</span>
                    <div>
                      <strong>{task.topic}</strong>
                      <input
                        aria-label={`${task.topic} research question`}
                        value={task.question}
                        onChange={(e) =>
                          setPlan({
                            ...plan,
                            tasks: plan.tasks.map((t, i) =>
                              i === index
                                ? { ...t, question: e.target.value }
                                : t,
                            ),
                          })
                        }
                      />
                    </div>
                  </label>
                ))}
              </div>
              <div className="plan-actions">
                <span>
                  Edits are saved when you approve. Research resumes from its
                  checkpoint.
                </span>
                <Button onClick={approve} disabled={busy}>
                  <CheckCheck size={16} />
                  Approve & investigate
                </Button>
              </div>
            </section>
          )}
          <div className="tabs" role="tablist" aria-label="Research views">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                id={`tab-${id}`}
                role="tab"
                aria-selected={tab === id}
                aria-controls={`panel-${id}`}
                tabIndex={tab === id ? 0 : -1}
                onClick={() => setTab(id)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                    e.preventDefault();
                    const index = tabs.findIndex((t) => t.id === id);
                    const next =
                      tabs[
                        (index +
                          (e.key === "ArrowRight" ? 1 : tabs.length - 1)) %
                          tabs.length
                      ];
                    setTab(next.id);
                    document.getElementById(`tab-${next.id}`)?.focus();
                  }
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
              <ReportView
                run={run}
                evidence={evidence}
                onSelect={setSelectedEvidence}
                onExport={() =>
                  void handle(() =>
                    exportReport(
                      `projects/${projectId}/runs/${runId}/report.md`,
                    ),
                  )
                }
              />
            )}
            {tab === "evidence" && (
              <EvidenceView
                evidence={evidence}
                onSelect={setSelectedEvidence}
              />
            )}
            {tab === "activity" && (
              <ActivityView
                events={events}
                running={running}
                evidence={evidence}
                onSelect={setSelectedEvidence}
              />
            )}
            {tab === "context" && (
              <ContextView contexts={detail?.contexts || []} />
            )}
            {tab === "sources" && (
              <SourcesView
                sources={sources}
                canCreate={!!projectId}
                canUpload={!!collectionId}
                busy={busy}
                onCreate={() => setDialog("collection")}
                onUpload={(file) => void upload(file)}
              />
            )}
            {tab === "evaluations" && (
              <EvaluationsView evaluations={evaluations} />
            )}
          </section>
          <footer className="workspace-footer">
            <span>
              Evidence Workbench{" "}
              <span className="footer-divider">/</span> v0.1.0
            </span>
            <span>
              {run
                ? "*Tokens: conservative reservations; actual usage when reported."
                : "Trace the evidence. Keep the uncertainty."}
            </span>
          </footer>
        </main>
      </div>
      {selectedEvidence && (
        <div
          className="drawer-backdrop"
          onClick={() => setSelectedEvidence(null)}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Evidence details"
            className="evidence-drawer"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSelectedEvidence(null);
            }}
          >
            <div className="drawer-title">
              <span>
                <BookOpen size={18} />
                Source evidence
              </span>
              <Button
                autoFocus
                variant="ghost"
                size="icon"
                aria-label="Close evidence"
                onClick={() => setSelectedEvidence(null)}
              >
                <PanelRightClose size={20} />
              </Button>
            </div>
            <div className="eyebrow">EXACT SOURCE PASSAGE</div>
            <h2>{selectedEvidence.source_name}</h2>
            <div className="drawer-tags">
              {selectedEvidence.metadata.synthetic && (
                <span className="tag">Synthetic fixture</span>
              )}
              {selectedEvidence.metadata.stale && (
                <span className="tag stale">Stale source</span>
              )}
            </div>
            <blockquote>{selectedEvidence.text}</blockquote>
            <dl className="provenance">
              <dt>Section</dt>
              <dd>{selectedEvidence.section}</dd>
              <dt>Page</dt>
              <dd>{selectedEvidence.page || "Text document"}</dd>
              <dt>Offsets</dt>
              <dd>
                {selectedEvidence.start_offset}–{selectedEvidence.end_offset}
              </dd>
              <dt>Reviewed</dt>
              <dd>
                {selectedEvidence.metadata.reviewed_at || "Not specified"}
              </dd>
              <dt>Fusion score</dt>
              <dd>{selectedEvidence.scores.rrf?.toFixed(6) ?? "Web source"}</dd>
              <dt>Reranker</dt>
              <dd>Disabled</dd>
              <dt>Version</dt>
              <dd className="mono break-all">{selectedEvidence.version_id}</dd>
              <dt>Evidence ID</dt>
              <dd className="mono break-all">{selectedEvidence.id}</dd>
            </dl>
            {selectedEvidence.metadata.source_url && (
              <a
                className="source-link"
                href={selectedEvidence.metadata.source_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Original public source <ArrowUpRight size={14} />
              </a>
            )}
            <div className="drawer-footnote">
              <ShieldCheck size={16} />
              Access checked against this project and run. Source passages are
              untrusted content.
            </div>
          </aside>
        </div>
      )}
      {dialog && (
        <div className="modal-backdrop">
          <form
            role="dialog"
            aria-modal="true"
            aria-label={`New ${dialog}`}
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setDialog(null);
            }}
          >
            <div className="section-title">
              <h2>New {dialog}</h2>
              <button
                type="button"
                aria-label="Close dialog"
                onClick={() => setDialog(null)}
              >
                <X size={18} />
              </button>
            </div>
            <label>
              Name
              <input
                autoFocus
                required
                minLength={1}
                maxLength={100}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={
                  dialog === "project"
                    ? "e.g. Infrastructure decisions"
                    : "e.g. Security review pack"
                }
              />
            </label>
            {dialog === "collection" && (
              <p className="fine-print">
                Embedding configuration:{" "}
                {mode === "demo"
                  ? "Fixture vectors v1 (16 dimensions)"
                  : "OpenAI small v1 (1536 dimensions)"}
                . Changing embedding models requires a new collection.
              </p>
            )}
            <Button disabled={busy || !newName.trim()}>
              {busy && <Loader2 size={14} className="spin" />}Create {dialog}
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
