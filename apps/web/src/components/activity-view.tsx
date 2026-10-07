"use client";

import { Activity, ArrowUpRight, Loader2, Check } from "lucide-react";

import { Empty } from "./empty";
import type { Evidence, RunEvent } from "@/lib/api";

export function ActivityView({
  events,
  running,
  evidence,
  onSelect,
}: {
  events: RunEvent[];
  running: boolean;
  evidence: Evidence[];
  onSelect: (e: Evidence | null) => void;
}) {
  const time = (s: string) =>
    new Date(s).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  return (
    <>
      <div className="section-title">
        <div>
          <h2>Execution activity</h2>
          <p>
            Ordered events from the durable worker. Safe to close this window.
          </p>
        </div>
        {running && (
          <span className="live-label">
            <Loader2 size={14} className="spin" />
            Polling saved progress
          </span>
        )}
      </div>
      {events.length === 0 ? (
        <Empty
          icon={Activity}
          title="Ready when you are"
          text="The timeline follows real graph transitions, tool calls, approvals, and retries."
        />
      ) : (
        <ol className="timeline">
          {events.map((event, index) => (
            <li key={event.id}>
              <div
                className={`timeline-dot ${event.stage === "error" ? "error" : ""}`}
              >
                {index === events.length - 1 && running ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <Check size={13} />
                )}
              </div>
              <div>
                <div className="timeline-title">
                  <strong>{event.message}</strong>
                  <time>{time(event.created_at)}</time>
                </div>
                <span className="stage-label">{event.stage}</span>
                {Array.isArray(event.data.evidence_ids) && (
                  <div className="event-citations">
                    {(event.data.evidence_ids as string[]).map((id) => (
                      <button
                        key={id}
                        onClick={() =>
                          onSelect(evidence.find((e) => e.id === id) || null)
                        }
                      >
                        Evidence {id.slice(0, 6)} <ArrowUpRight size={11} />
                      </button>
                    ))}
                  </div>
                )}
                <details>
                  <summary>Event data</summary>
                  <pre>{JSON.stringify(event.data, null, 2)}</pre>
                </details>
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
