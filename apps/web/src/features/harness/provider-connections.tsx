"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PlugZap, RefreshCw, Unplug, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/error-notice";
import { harnessOptions, useConnectionAction } from "./queries";
import { ConnectionForm } from "./connection-form";
import { ModelVerification } from "./model-verification";
import { RevisionForm } from "./revision-form";
import { stages, type Connection, type HarnessState } from "./contracts";
import notebook from "@/features/workbench/notebook.module.css";
import styles from "./harness.module.css";

export function ProviderConnections({
  projectId,
  active,
  enabled,
}: {
  projectId: string;
  active: boolean;
  enabled: boolean;
}) {
  const query = useQuery(harnessOptions(projectId, active && enabled));
  if (!enabled) return null;
  return (
    <section
      aria-label="Provider connections and harness revisions"
      className={styles.root}
    >
      <ErrorNotice
        title="Harness settings could not load"
        error={query.error}
        onRetry={() => void query.refetch()}
      />
      {query.isPending && <p role="status">Loading local provider settings…</p>}
      {query.data && (
        <>
          <div className={notebook.twoColumns}>
            <section
              className={notebook.surface}
              aria-label="Local provider connections"
            >
              <div className={notebook.surfaceHead}>
                <PlugZap size={17} />
                Local provider connections
              </div>
              <div className={notebook.pad}>
                <p className="fine-print">
                  OpenAI is the first supported adapter. Models come from the
                  connected account’s catalog; only an explicit contract check
                  verifies research compatibility.
                </p>
                <ConnectionForm
                  projectId={projectId}
                  serverKey={query.data.server_key_available}
                />
              </div>
            </section>
            <section
              className={notebook.surface}
              aria-label="Harness model targets"
            >
              <div className={notebook.surfaceHead}>
                <Layers size={17} />
                Harness model targets
              </div>
              <div className={notebook.pad}>
                <RevisionForm projectId={projectId} state={query.data} />
              </div>
            </section>
          </div>
          <div className={styles.connections}>
            {query.data.connections.map((connection) => (
              <ConnectionCard
                key={connection.id}
                projectId={projectId}
                connection={connection}
                state={query.data!}
              />
            ))}
          </div>
          <section
            className={styles.revisions}
            aria-label="Saved harness revisions"
          >
            <h2>Saved harness revisions</h2>
            {!query.data.revisions.length && (
              <p className="fine-print">
                Verify a model, choose task targets, and save a revision to pin
                a research configuration.
              </p>
            )}
            {query.data.revisions.map((revision) => (
              <details key={revision.id} className={notebook.surface}>
                <summary>
                  {revision.name}{" "}
                  <span className="mono">{revision.id.slice(0, 8)}</span>
                </summary>
                <div className={notebook.pad}>
                  <p className="fine-print">
                    {revision.id} ·{" "}
                    {new Date(revision.created_at).toLocaleString()}
                  </p>
                  <dl className={styles.fingerprints}>
                    {stages.map(([stage, label]) => (
                      <div key={stage}>
                        <dt>{label}</dt>
                        <dd>
                          {revision.snapshot.targets[stage].connection_name} /{" "}
                          {revision.snapshot.targets[stage].model_id}
                        </dd>
                        <dt>Prompt / contract SHA-256</dt>
                        <dd>
                          {revision.snapshot.fingerprints.prompts[stage]}
                          <br />
                          {revision.snapshot.fingerprints.contracts[stage]}
                        </dd>
                      </div>
                    ))}
                    <dt>Context / tool policy</dt>
                    <dd>
                      {revision.snapshot.fingerprints.context_policy} /{" "}
                      {revision.snapshot.fingerprints.tool_policy}
                    </dd>
                    <dt>Token / cost cap</dt>
                    <dd>
                      {revision.snapshot.limits.tokens} tokens / $
                      {revision.snapshot.limits.estimated_cost_usd}
                    </dd>
                  </dl>
                </div>
              </details>
            ))}
          </section>
        </>
      )}
    </section>
  );
}
function ConnectionCard({
  projectId,
  connection,
  state,
}: {
  projectId: string;
  connection: Connection;
  state: HarnessState;
}) {
  const [confirm, setConfirm] = useState(false);
  const discovery = useConnectionAction(projectId, connection.id, "discover");
  const revoke = useConnectionAction(projectId, connection.id, "disconnect");
  const busy = discovery.isPending || revoke.isPending;
  return (
    <section
      className={notebook.surface}
      aria-label={`Provider ${connection.name}`}
    >
      <div className={notebook.surfaceHead}>
        <PlugZap size={17} />
        {connection.name}
        <span className="status-badge">
          {connection.active ? "Credential stored" : "Disconnected"}
        </span>
      </div>
      <div className={notebook.pad}>
        <div className={styles.controls}>
          <Button
            variant="secondary"
            disabled={!connection.active || busy}
            onClick={() => discovery.mutate()}
          >
            <RefreshCw size={14} />
            {discovery.isPending ? "Discovering…" : "Discover available models"}
          </Button>
          <Button
            variant="ghost"
            disabled={!connection.active || busy}
            onClick={() => setConfirm(true)}
          >
            <Unplug size={14} />
            Disconnect
          </Button>
        </div>
        {confirm && connection.active && (
          <div className={notebook.note}>
            <p>
              Disconnecting removes the stored credential and stops future calls
              through this connection, including saved revisions. In-flight
              provider calls may finish.
            </p>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                revoke.mutate(undefined, { onSuccess: () => setConfirm(false) })
              }
            >
              Confirm disconnect
            </Button>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Keep connection
            </Button>
          </div>
        )}
        <ErrorNotice error={discovery.error || revoke.error} />
        <p className="fine-print">
          {connection.catalog.length} catalog models
          {connection.discovered_at &&
            ` · discovered ${new Date(connection.discovered_at).toLocaleString()}`}
          . Catalog discovery makes no inference calls.
        </p>
        {connection.catalog_discovery ? (
          <div className="fine-print" aria-label="Catalog response provenance">
            <p>
              OpenAI returned {connection.catalog_discovery.returned_count}{" "}
              model IDs; {connection.catalog_discovery.unique_count} unique IDs
              are listed. No model-family or capability filter is applied.
            </p>
            <details className={styles.catalog}>
              <summary>Inspect discovery response details</summary>
              <p className="mono">{connection.catalog_discovery.endpoint}</p>
              {connection.catalog_discovery.request_id && (
                <p className="mono">
                  Request ID: {connection.catalog_discovery.request_id}
                </p>
              )}
            </details>
          </div>
        ) : connection.discovered_at ? (
          <p className="fine-print">
            This is a saved catalog. Discover again to confirm the current
            provider response and its returned count.
          </p>
        ) : null}
        {connection.catalog.length > 0 && (
          <details className={styles.catalog}>
            <summary>Inspect discovered model IDs</summary>
            <ul>
              {connection.catalog.map((id) => (
                <li className="mono" key={id}>
                  {id}
                </li>
              ))}
            </ul>
          </details>
        )}
        {connection.active && (
          <ModelVerification
            projectId={projectId}
            connection={connection}
            liveEnabled={state.live_enabled}
            checks={state.checks.filter(
              (check) => check.connection_id === connection.id,
            )}
          />
        )}
      </div>
    </section>
  );
}
