import { CheckCheck, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/error-notice";
import type { IngestionJob } from "@/lib/contracts";
import { activeIngestion } from "./ingestion-state";
import type { UploadQueue } from "./use-upload-queue";
import styles from "./collections.module.css";

const phases: Record<IngestionJob["phase"], string> = {
  queued: "Queued · waiting for preparation",
  reading: "Reading source passages",
  embedding: "Preparing search vectors",
  storage: "Saving source file",
  indexing: "Indexing source passages",
  finished: "Finished",
};

function PreparationRow({
  job,
  queue,
}: {
  job: IngestionJob;
  queue: UploadQueue;
}) {
  const active = activeIngestion(job);
  const result = job.result;
  return (
    <li>
      <div>
        <strong>{job.name}</strong>
        <span role="status">
          {active ? (
            <>
              <Loader2 size={14} className="spin" />
              {phases[job.phase]}
            </>
          ) : job.status === "ready" ? (
            <>
              <CheckCheck size={14} />
              {result?.deduplicated
                ? "Ready · reused existing version"
                : `Ready · ${result?.chunks ?? 0} passages, ${result?.vector_chunks ?? 0} vectors`}
            </>
          ) : job.status === "cancelled" ? (
            "Preparation cancelled"
          ) : (
            "Preparation failed"
          )}
        </span>
        {job.error && <p className="source-error">{job.error}</p>}
      </div>
      {active ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={queue.actionPending}
          help="Stop this saved preparation job. An embedding request already in progress may finish and be charged; the previous source version is preserved."
          onClick={() => queue.cancelJob(job.id)}
        >
          <X size={13} />
          Cancel {job.name}
        </Button>
      ) : (
        (job.status === "failed" || job.status === "cancelled") && (
          <Button
            variant="secondary"
            size="sm"
            disabled={queue.actionPending}
            help="Retry preparation using the saved file. Live indexing may incur embedding charges. A repeated retry request reuses the same attempt."
            onClick={() => queue.retryJob(job.id)}
          >
            <RotateCcw size={13} />
            Retry {job.name}
          </Button>
        )
      )}
    </li>
  );
}

export function UploadBatch({
  queue,
  collectionId,
}: {
  queue: UploadQueue;
  collectionId: string;
}) {
  const rows = queue.rows.filter((row) => row.collectionId === collectionId);
  const jobs = queue.visibleJobs.filter(
    (job) => job.collection_id === collectionId,
  );
  return (
    <>
      <ErrorNotice error={queue.batchError} />
      <ErrorNotice
        title="File preparation status unavailable"
        error={queue.jobsError}
        onRetry={() => void queue.refreshJobs()}
      />
      <ErrorNotice
        title="File preparation action failed"
        error={queue.actionError}
      />
      {(rows.length > 0 || jobs.length > 0) && (
        <section className={styles.batch} aria-label="Upload results">
          <div className={styles.batchHead}>
            <h3>File preparation</h3>
            <Button
              variant="ghost"
              size="sm"
              disabled={queue.busy}
              help="Hide completed and failed entries from this list. Saved sources and active jobs remain. Reloading restores recent preparation history."
              onClick={() => queue.clear(collectionId)}
            >
              Clear finished files
            </Button>
          </div>
          <ul className={styles.files}>
            {rows.map((row) => (
              <li key={row.id}>
                <div>
                  <strong>{row.file.name}</strong>
                  <span role="status">
                    {row.status === "uploading" ? (
                      <>
                        <Loader2 size={14} className="spin" />
                        Uploading source file
                      </>
                    ) : row.status === "queued" ? (
                      "Waiting to upload"
                    ) : row.status === "invalid" ? (
                      "File needs correction"
                    ) : (
                      "Upload failed"
                    )}
                  </span>
                  {row.error && <p className="source-error">{row.error}</p>}
                </div>
                {row.status === "failed" && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={queue.busy}
                    help="Retry this upload. A lost response reuses the same request; it does not repeat an already accepted preparation job."
                    onClick={() => void queue.retry(row.id)}
                  >
                    <RotateCcw size={13} />
                    Retry {row.file.name}
                  </Button>
                )}
              </li>
            ))}
            {jobs.map((job) => (
              <PreparationRow key={job.id} job={job} queue={queue} />
            ))}
          </ul>
          <p className="fine-print">
            Preparation continues after you leave this view. Queued files wait
            for the file preparation service. Failed files need an explicit
            retry; previous indexed versions remain searchable.
          </p>
        </section>
      )}
    </>
  );
}
