import type { Context } from "@/lib/contracts";

export type SavedPassage = {
  evidenceId: string;
  source: string | null;
  passage: string;
  section: string | null;
  page: number | null;
  offsets: [number, number] | null;
};

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown) => (typeof value === "string" ? value : null);

export function savedContextInput(context: Context) {
  const input = object(context.payload.assembled_input);
  const structured =
    !!input &&
    ["trusted_instructions", "user_requirements", "untrusted_sources"].some(
      (key) => Object.hasOwn(input, key),
    );
  const entries =
    input && Array.isArray(input.untrusted_sources)
      ? input.untrusted_sources
      : [];
  const passages: SavedPassage[] = [];
  for (const entry of entries) {
    const source = object(entry);
    if (
      !source ||
      typeof source.evidence_id !== "string" ||
      typeof source.passage !== "string"
    )
      continue;
    const offsets = source.offsets;
    passages.push({
      evidenceId: source.evidence_id,
      source: text(source.source),
      passage: source.passage,
      section: text(source.section),
      page:
        typeof source.page === "number" && Number.isFinite(source.page)
          ? source.page
          : null,
      offsets:
        Array.isArray(offsets) &&
        offsets.length === 2 &&
        offsets.every(
          (value) => typeof value === "number" && Number.isFinite(value),
        )
          ? [offsets[0], offsets[1]]
          : null,
    });
  }
  // Never reconstruct a redacted/missing input from unredacted run/source records.
  return {
    structured,
    instructions: text(input?.trusted_instructions),
    question: text(input?.user_requirements),
    summary: input?.durable_summary,
    passages,
    sourcesRecorded: Array.isArray(input?.untrusted_sources),
    unreadablePassages: entries.length - passages.length,
  };
}
