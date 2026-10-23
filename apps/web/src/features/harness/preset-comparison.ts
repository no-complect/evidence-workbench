import type { HarnessPresetSettings } from "../../../../../packages/contracts/models";
import { limitFields } from "@/features/workbench/research-state";
import { stages } from "./contracts";

export type SettingRow = { label: string; left: string; right: string };
function fields(settings: HarnessPresetSettings): [string, string][] {
  return [
    [
      "System instruction",
      settings.configuration.system_instruction || "No additional instruction",
    ],
    ["Context policy", settings.configuration.context_policy],
    ["Selected model", settings.model_id ?? "Server default at execution"],
    ...stages.map(([stage, label]): [string, string] => [
      `${label} model`,
      settings.configuration.stage_models[stage] ?? "Use selected model",
    ]),
    ["Evaluation judge", settings.judge_model_id ?? "Off"],
    ...limitFields.map(([key, label]): [string, string] => [
      label,
      String(settings.limits[key]),
    ]),
  ];
}
export function compareSettings(
  left: HarnessPresetSettings,
  right: HarnessPresetSettings,
): SettingRow[] {
  const other = new Map(fields(right));
  return fields(left).map(([label, value]) => ({
    label,
    left: value,
    right: other.get(label)!,
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
