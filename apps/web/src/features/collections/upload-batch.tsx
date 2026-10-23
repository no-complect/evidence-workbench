import { CheckCheck, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/error-notice";
import type { UploadQueue } from "./use-upload-queue";
import styles from "./collections.module.css";

export function UploadBatch({
  queue,
  collectionId,
}: {
  queue: UploadQueue;
  collectionId: string;
}) {
  const rows = queue.rows.filter((row) => row.collectionId === collectionId);
  return (
    <>
      <ErrorNotice error={queue.batchError} />
      {rows.length > 0 && (
        <section className={styles.batch} aria-label="Upload results">
          <div className={styles.batchHead}>
            <h3>File preparation</h3>
            <Button
              help="Clear completed and failed entries from this upload list. Saved sources remain in the collection; active uploads are retained."
              variant="ghost"
              size="sm"
              disabled={queue.busy}
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
                        Uploading &amp; indexing
                      </>
                    ) : row.status === "queued" ? (
                      "Waiting"
                    ) : row.status === "ready" ? (
                      <>
                        <CheckCheck size={14} />
                        {row.result?.deduplicated
                          ? "Ready · reused existing version"
                          : `Ready · ${row.result?.chunks ?? 0} passages, ${row.result?.vector_chunks ?? 0} vectors`}
                      </>
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
                    help="Retry this file. Identical filename and bytes reuse the existing immutable version; extraction errors may require correcting and selecting the file again."
                    variant="secondary"
                    size="sm"
                    disabled={queue.busy}
                    onClick={() => void queue.retry(row.id)}
                  >
                    <RotateCcw size={13} />
                    Retry {row.file.name}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <p className="fine-print">
            Files are processed one at a time. A failed file does not discard
            successful uploads. Retrying the same filename and bytes reuses its
            immutable version.
          </p>
        </section>
      )}
    </>
  );
}
