"use client";
import { useState } from "react";
import { BookmarkPlus, ArrowDownToLine } from "lucide-react";
import type { HarnessPresetSettings } from "../../../../../packages/contracts/models";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/tooltip";
import { ErrorNotice } from "@/components/error-notice";
import { useHarnessPresets } from "./preset-queries";
import { unavailableModels } from "./preset-comparison";
import styles from "./presets.module.css";
import { PresetComparison } from "./preset-comparison-view";

export function HarnessPresets({
  projectId,
  active,
  draft,
  draftError,
  availableModels,
  onApply,
}: {
  projectId: string;
  active: boolean;
  draft: HarnessPresetSettings | null;
  draftError: string;
  availableModels: string[] | undefined;
  onApply: (settings: HarnessPresetSettings) => void;
}) {
  const { query, save, submit } = useHarnessPresets(projectId, active);
  const [name, setName] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [compareId, setCompareId] = useState("");
  const [message, setMessage] = useState("");
  const presets = query.data ?? [];
  const selected = presets.find((item) => item.id === selectedId);
  const comparison = compareId
    ? presets.find((item) => item.id === compareId)
    : undefined;
  const unavailable =
    selected && availableModels
      ? unavailableModels(selected.settings, availableModels)
      : [];
  return (
    <section className={styles.surface} aria-label="Saved harness presets">
      <header className={styles.head}>
        <span>
          <BookmarkPlus size={17} aria-hidden="true" /> Save the configuration.
          Keep the comparison.
          <HelpTip
            label="Harness presets"
            content="Presets save instructions, model targets, an optional judge selection and resource limits. Applying one replaces those draft settings only. It does not start work, enable live mode or authorize paid grading."
          />
        </span>
        <small>Immutable · project &amp; user scoped</small>
      </header>
      <div className={styles.grid}>
        <div className={styles.library}>
          <p className={styles.kicker}>REUSABLE CONFIGURATIONS</p>
          <p className={styles.description}>
            Save a baseline, adjust the draft, then see exactly what changed.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (draft && name.trim() && !save.isPending) {
                setMessage("");
                submit(name, draft, (id) => {
                  setSelectedId(id);
                  setMessage("Preset saved. The current draft is unchanged.");
                });
              }
            }}
          >
            <label className={styles.field}>
              Preset name
              <input
                value={name}
                maxLength={100}
                required
                disabled={save.isPending}
                placeholder="e.g. Evidence-first baseline"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <Button
              type="submit"
              disabled={!draft || !name.trim() || save.isPending}
              aria-busy={save.isPending}
              help="Save a new immutable copy of the current settings. This makes no model calls."
            >
              <BookmarkPlus size={14} />
              {save.isPending ? "Saving preset…" : "Save current draft"}
            </Button>
          </form>
          {draftError && (
            <p role="alert" className={styles.description}>
              {draftError}
            </p>
          )}
          <ErrorNotice error={save.error} onDismiss={save.reset} />
          <ErrorNotice
            title="Presets could not load"
            error={query.error}
            onRetry={() => void query.refetch()}
          />
          {query.isPending && (
            <p className={styles.description}>Loading saved presets…</p>
          )}
          {!query.isPending && !query.error && presets.length === 0 && (
            <p className={styles.description}>
              No presets yet. Save this draft to establish a baseline.
            </p>
          )}
          {presets.length > 0 && (
            <>
              <label className={styles.field}>
                Saved preset
                <select
                  value={selectedId}
                  onChange={(event) => {
                    setSelectedId(event.target.value);
                    setMessage("");
                  }}
                >
                  <option value="">Choose a baseline</option>
                  {presets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name} · {preset.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
              {selected && (
                <>
                  <p className={styles.identity}>
                    Saved {new Date(selected.created_at).toLocaleString()}
                    <br />
                    Settings v{selected.schema_version} ·{" "}
                    <code>{selected.settings_hash.slice(0, 12)}</code>
                  </p>
                  {unavailable.length > 0 && (
                    <p className={styles.warning}>
                      Not in the current model catalog: {unavailable.join(", ")}
                      . Applying keeps these IDs; choose available models before
                      live execution.
                    </p>
                  )}
                  {availableModels === undefined && (
                    <p className={styles.description}>
                      Model availability has not been checked. Execution
                      validates the current server catalog.
                    </p>
                  )}
                  <Button
                    variant="secondary"
                    onClick={() => {
                      onApply(selected.settings);
                      setMessage(
                        `Applied ${selected.name} to the draft. Execution mode, question and saved runs are unchanged.`,
                      );
                    }}
                    help="Replace draft instructions, model targets, judge selection and limits with this preset. No research or grading starts."
                  >
                    <ArrowDownToLine size={14} /> Apply to draft
                  </Button>
                </>
              )}
            </>
          )}
          {message && (
            <p role="status" className={styles.description}>
              {message}
            </p>
          )}
        </div>
        <PresetComparison
          presets={presets}
          selected={selected}
          comparison={comparison}
          compareId={compareId}
          onCompare={setCompareId}
          draft={draft}
        />
      </div>
    </section>
  );
}
