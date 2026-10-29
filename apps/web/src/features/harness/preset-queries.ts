import { useRef } from "react";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  HarnessPreset,
  HarnessPresetSettings,
} from "../../../../../packages/contracts/models";
import {
  submissionIntent,
  type SubmissionIntent,
} from "@/features/workbench/research-state";
import { presetApi } from "./api";

export const presetKey = (project: string) =>
  ["workbench", "project", project, "harness-presets"] as const;
export const presetOptions = (project: string, active: boolean) =>
  queryOptions({
    queryKey: presetKey(project),
    queryFn: ({ signal }) => presetApi.list(project, signal),
    enabled: !!project && active,
    staleTime: 60_000,
  });

export function useHarnessPresets(project: string, active: boolean) {
  const client = useQueryClient();
  const query = useQuery(presetOptions(project, active));
  const intent = useRef<SubmissionIntent | null>(null);
  const save = useMutation({
    mutationFn: (body: Parameters<typeof presetApi.save>[1]) =>
      presetApi.save(project, body),
    retry: false,
    onSuccess: (preset) => {
      intent.current = null;
      client.setQueryData<HarnessPreset[]>(presetKey(project), (previous) => [
        preset,
        ...(previous ?? []).filter((item) => item.id !== preset.id),
      ]);
      void client.invalidateQueries({
        queryKey: presetKey(project),
        exact: true,
      });
    },
  });
  function submit(
    name: string,
    settings: HarnessPresetSettings,
    onSaved: (id: string) => void,
  ) {
    if (save.isPending) return;
    const body = { name: name.trim(), settings };
    intent.current = submissionIntent(intent.current, body, () =>
      crypto.randomUUID(),
    );
    save.mutate(
      { ...body, idempotency_key: intent.current.key },
      {
        onSuccess: (preset) => onSaved(preset.id),
      },
    );
  }
  return { query, save, submit };
}
