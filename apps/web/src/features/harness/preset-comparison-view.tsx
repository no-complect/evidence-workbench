import { useState } from "react";
import { GitCompareArrows } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  HarnessPreset,
  HarnessPresetSettings,
} from "../../../../../packages/contracts/models";
import { compareSettings } from "./preset-comparison";
import styles from "./presets.module.css";

export function PresetComparison({
  presets,
  selected,
  comparison,
  compareId,
  onCompare,
  draft,
}: {
  presets: HarnessPreset[];
  selected: HarnessPreset | undefined;
  comparison: HarnessPreset | undefined;
  compareId: string;
  onCompare: (id: string) => void;
  draft: HarnessPresetSettings | null;
}) {
  const [showAll, setShowAll] = useState(false);
  const target = compareId ? comparison?.settings : draft;
  const rows =
    selected && target ? compareSettings(selected.settings, target) : [];
  const changes = rows.filter((row) => row.changed);
  return (
    <div className={styles.comparison}>
      <div className={styles.comparisonHead}>
        <GitCompareArrows size={16} aria-hidden="true" />
        <h3>Configuration comparison</h3>
      </div>
      <p className={styles.description}>
        A settings comparison, not a quality score. Run a fixed evaluation suite
        to measure behavior.
      </p>
      <label className={styles.field}>
        Compare baseline with
        <select
          value={compareId}
          onChange={(event) => onCompare(event.target.value)}
        >
          <option value="">Current draft</option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name} · {preset.id.slice(0, 8)}
            </option>
          ))}
        </select>
      </label>
      {!selected ? (
        <p className={styles.empty}>
          Choose a saved preset to inspect its differences.
        </p>
      ) : !target ? (
        <p className={styles.empty}>
          Correct the draft limits to compare this configuration.
        </p>
      ) : (
        <>
          <div className={styles.summary}>
            <span>
              {changes.length} of {rows.length} settings differ
            </span>
            <Button
              variant="ghost"
              onClick={() => setShowAll(!showAll)}
              aria-pressed={showAll}
            >
              {showAll ? "Show differences" : "Show all settings"}
            </Button>
          </div>
          {changes.length === 0 && !showAll ? (
            <p className={styles.empty}>All saved settings match.</p>
          ) : (
            <div
              className={styles.tableScroll}
              tabIndex={0}
              role="region"
              aria-label="Configuration differences"
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">Setting</th>
                    <th scope="col">{selected.name}</th>
                    <th scope="col">{comparison?.name ?? "Current draft"}</th>
                  </tr>
                </thead>
                <tbody>
                  {(showAll ? rows : changes).map((row) => (
                    <tr key={row.label} data-changed={row.changed}>
                      <th scope="row">{row.label}</th>
                      <td>{row.left}</td>
                      <td>{row.right}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <p className={styles.description}>
        Presets contain no credentials or execution consent. Future runs pin
        their own model, prompt and source snapshots.
      </p>
    </div>
  );
}
