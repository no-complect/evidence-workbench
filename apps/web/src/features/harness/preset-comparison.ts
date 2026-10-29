import type { HarnessPresetSettings } from "../../../../../packages/contracts/models";
import { limitFields } from "@/features/workbench/research-state";
import { stages } from "./contracts";

export type SettingRow = {
  label: string;
  left: string;
  right: string;
  changed: boolean;
};

type SettingValue = string | number | null;

function field(label: string, value: SettingValue, empty = "") {
  return {
    label,
    value,
    display: value === null || value === "" ? empty : String(value),
  };
}

function fields(settings: HarnessPresetSettings) {
  return [
    field(
      "System instruction",
      settings.configuration.system_instruction,
      "No additional instruction",
    ),
    field("Context policy", settings.configuration.context_policy),
    field("Selected model", settings.model_id, "Server default at execution"),
    ...stages.map(([stage, label]) =>
      field(
        `${label} model`,
        settings.configuration.stage_models[stage],
        "Use selected model",
      ),
    ),
    field("Evaluation judge", settings.judge_model_id, "Off"),
    ...limitFields.map(([key, label]) => field(label, settings.limits[key])),
  ];
}

export function compareSettings(
  left: HarnessPresetSettings,
  right: HarnessPresetSettings,
): SettingRow[] {
  const other = new Map(fields(right).map((item) => [item.label, item]));
  return fields(left).map((item) => ({
    label: item.label,
    left: item.display,
    right: other.get(item.label)!.display,
    changed: item.value !== other.get(item.label)!.value,
  }));
}

export function unavailableModels(
  settings: HarnessPresetSettings,
  available: string[],
): string[] {
  return [
    ...new Set(
      [
        settings.model_id,
        settings.judge_model_id,
        ...Object.values(settings.configuration.stage_models),
      ].filter((id): id is string => !!id),
    ),
  ].filter((id) => !available.includes(id));
}
