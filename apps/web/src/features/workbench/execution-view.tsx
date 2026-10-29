"use client";

import { useState } from "react";
import {
  ListChecks,
  Files,
  GitBranch,
  NotebookPen,
  ShieldCheck,
  ArrowUpRight,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, HelpTip } from "@/components/ui/tooltip";
import type { RunSnapshot, Evidence } from "@/lib/contracts";
import type { ResearchStrategy } from "./research-state";
import { executionNodes, nodeRecords } from "./execution-state";
import { ContextRecordView } from "@/features/context/context-record-view";
import styles from "./execution-view.module.css";
import studio from "@/features/harness/studio.module.css";

const icons = {
  plan: ListChecks,
  gather: Files,
  assess: GitBranch,
  report: NotebookPen,
  verify: ShieldCheck,
};

export function ExecutionView({
  snapshot,
  strategy,
  onStrategyChange,
  onHarness,
  onEvidence,
  onInspectEvidence,
}: {
  snapshot: RunSnapshot | undefined;
  strategy: ResearchStrategy;
  onStrategyChange: (value: ResearchStrategy) => void;
  onHarness: () => void;
  onEvidence: () => void;
  onInspectEvidence: (evidence: Evidence) => void;
}) {
  const [selected, setSelected] = useState("gather");
  const run = snapshot?.detail.run;
  const savedStrategy = run?.strategy ?? strategy;
  const records = nodeRecords(
    selected,
    snapshot?.events ?? [],
    snapshot?.detail.contexts ?? [],
  );
  const tasks = run?.plan?.tasks ?? [];
  return (
    <>
      <div className="section-title">
        <div>
          <h2>Follow the work, not just the answer.</h2>
          <p>
            {run
              ? "Saved execution · select a node to inspect its boundary."
              : "Workflow structure · start an investigation to inspect its saved execution."}
          </p>
        </div>
        <Workflow size={20} className="muted" />
      </div>
      <div className={styles.layout}>
        <section aria-label="Workflow graph">
          <label className={studio.field}>
            Workflow template
            <select
              aria-label="Workflow template"
              disabled={!!run}
              value={savedStrategy}
              onChange={(e) =>
                onStrategyChange(e.target.value as ResearchStrategy)
              }
            >
              <option value="agent">Bounded research · LangGraph</option>
              <option value="workflow">Fixed research workflow</option>
              <option value="rag">Basic RAG</option>
            </select>
          </label>
          <div className={styles.flow} style={{ marginTop: 15 }}>
            {executionNodes.map((node, index) => {
              const Icon = icons[node.id];
              const data = nodeRecords(
                node.id,
                snapshot?.events ?? [],
                snapshot?.detail.contexts ?? [],
              );
              return (
                <div key={node.id}>
                  {index > 0 && (
                    <div className={styles.line} aria-hidden="true" />
                  )}
                  <div className={styles.row}>
                    <Tooltip
                      content={`Inspect the ${node.label.toLowerCase()} boundary and its saved events and contexts. Selecting this node does not execute or replay the stage.`}
                    >
                      <button
                        type="button"
                        className={styles.node}
                        aria-pressed={selected === node.id}
                        onClick={() => setSelected(node.id)}
                      >
                        <Icon size={19} />
                        <span>
                          <strong>{node.label}</strong>
                          <small>
                            {node.id === "plan" &&
                            run?.status === "awaiting_approval"
                              ? "Waiting for your approval"
                              : data.events.length
                                ? `${data.events.length} saved events`
                                : node.subtitle}
                          </small>
                        </span>
                      </button>
                    </Tooltip>
                  </div>
                  {node.id === "gather" && tasks.length > 0 && (
                    <>
                      <div className={styles.line} aria-hidden="true" />
                      <div className={styles.branches}>
                        {tasks.map((task) => (
                          <div className={styles.branch} key={task.id}>
                            <strong>{task.topic}</strong>
                            <small>{task.question}</small>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {node.id === "assess" && (
                    <div className={styles.loop}>
                      {savedStrategy === "agent"
                        ? `↳ Follow up within ${run?.request.limits.iterations ?? "configured"} iterations`
                        : "↓ Proceed to synthesis"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className={studio.annotation}>
            <strong>REPRODUCIBILITY</strong>Graph transitions, context traces,
            and source identities belong to the saved run. Closing the browser
            does not stop the worker.
          </div>
        </section>
        <section className={styles.inspector} aria-label="Node inspector">
          <div className={styles.head}>
            Node inspector
            <HelpTip
              label="Node inspector"
              content="Inspect saved events and assembled inputs for the selected stage. Missing records are not presented as completed work; this panel does not replay model calls."
            />
            <small>{run ? "Saved run trace" : "Workflow definition"}</small>
          </div>
          <div className={styles.body}>
            <h3>{records.node.label}</h3>
            <p>{records.node.description}</p>
            <dl className={styles.metrics}>
              <dt>Component</dt>
              <dd>{records.node.component}</dd>
              <dt>Boundary</dt>
              <dd>{records.node.boundary}</dd>
              <dt>Persisted output</dt>
              <dd>{records.node.output}</dd>
            </dl>
            <div className={studio.label}>SAVED EXECUTION</div>
            {!records.events.length && !records.contexts.length && (
              <p>
                No execution records for this node yet. The structure above
                describes the real workflow; it is not a simulated run.
              </p>
            )}
            {records.events.map((event) => (
              <div className={styles.event} key={event.id}>
                <strong>{event.message}</strong>
                <time>{new Date(event.created_at).toLocaleString()}</time>
                <details>
                  <summary>Inspect event data</summary>
                  <pre>{JSON.stringify(event.data, null, 2)}</pre>
                </details>
              </div>
            ))}
            {records.contexts.map((context) => (
              <details className={styles.event} key={context.id}>
                <summary>{context.stage} · assembled context</summary>
                <p>
                  {context.payload.selected?.length ?? "not recorded"} selected
                  · {context.payload.excluded?.length ?? "not recorded"}{" "}
                  excluded passages
                </p>
                <p className="fine-print">
                  Policy: {context.payload.policy_version} · Prompt:{" "}
                  {context.payload.prompt_id}
                </p>
                <ContextRecordView
                  context={context}
                  evidence={snapshot?.detail.evidence}
                  onInspect={onInspectEvidence}
                />
              </details>
            ))}
            <div className={styles.actions}>
              <Button variant="secondary" onClick={onHarness}>
                Inspect the harness <ArrowUpRight size={13} />
              </Button>
              <Button variant="ghost" onClick={onEvidence}>
                Open evidence <ArrowUpRight size={13} />
              </Button>
            </div>
          </div>
          <div className={studio.annotation}>
            <strong>BOUNDED ORCHESTRATION</strong>Research tasks share token,
            tool, and execution limits. Approval, cancellation, and recovery
            remain server-controlled.
          </div>
        </section>
      </div>
    </>
  );
}
