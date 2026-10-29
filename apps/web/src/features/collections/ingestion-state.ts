import type { IngestionJob } from "@/lib/contracts";

export const activeIngestion = (job: IngestionJob) =>
  job.status === "queued" || job.status === "running";

// History stays on the server; the file list presents the latest attempt per name.
export function latestPreparations(jobs: IngestionJob[]): IngestionJob[] {
  const latest = new Map<string, IngestionJob>();
  for (const job of jobs) {
    const key = `${job.collection_id}/${job.name}`;
    const previous = latest.get(key);
    if (
      !previous ||
      job.created_at > previous.created_at ||
      (job.created_at === previous.created_at && job.id > previous.id)
    )
      latest.set(key, job);
  }
  return [...latest.values()];
}
