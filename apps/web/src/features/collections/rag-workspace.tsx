import { Plus, RotateCcw } from "lucide-react";
import type { Collection } from "@/lib/contracts";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/error-notice";
import { WorkspaceHeading } from "@/features/workbench/workspace-shell";
import { SourcesPanel } from "@/features/workbench/sources-panel";
import { RetrievalExperiment } from "./retrieval-experiment";
import { useResumeCollection } from "./queries";
import type { UploadQueue } from "./use-upload-queue";
import notebook from "@/features/workbench/notebook.module.css";

export function RagWorkspace({
  projectId,
  collections,
  collectionsStatus,
  collectionId,
  active,
  uploads,
  onSelect,
  onCreate,
}: {
  projectId: string;
  collections: Collection[];
  collectionsStatus: "pending" | "error" | "success";
  collectionId: string;
  active: boolean;
  uploads: UploadQueue;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const collection = collections.find((item) => item.id === collectionId);
  const ready =
    collectionsStatus === "success" &&
    !!collection &&
    (!collection.setup_status || collection.setup_status === "ready");
  return (
    <>
      <WorkspaceHeading
        kicker="RAG / COLLECTIONS & RETRIEVAL"
        title="Give the answer a foundation."
        action={
          <Button
            help="Walk through purpose, sources, preparation and a retrieval test. Use bundled synthetic documents or upload your own."
            disabled={
              !projectId || uploads.busy || collectionsStatus !== "success"
            }
            onClick={onCreate}
          >
            <Plus size={16} />
            Add Collection
          </Button>
        }
      >
        Add a collection, prepare its sources, and compare how retrieval finds
        evidence for the same question.
      </WorkspaceHeading>
      <label className={notebook.collectionControl}>
        Collection
        <select
          aria-label="RAG collection"
          value={collectionId}
          disabled={
            !projectId ||
            collectionsStatus !== "success" ||
            collections.length === 0
          }
          onChange={(event) => onSelect(event.target.value)}
        >
          <option value="" disabled>
            {collectionsStatus === "pending"
              ? "Loading collections…"
              : collectionsStatus === "error"
                ? "Collections unavailable"
                : collections.length
                  ? "Select a collection"
                  : "No collections yet"}
          </option>
          {collections.map((item) => (
            <option value={item.id} key={item.id}>
              {item.name} · {item.document_count} docs
              {item.setup_status &&
                item.setup_status !== "ready" &&
                ` · ${item.setup_status}`}
            </option>
          ))}
        </select>
      </label>
      {collectionsStatus === "success" && collections.length === 0 && (
        <p className="fine-print" role="status">
          Add a collection to prepare your sources.
        </p>
      )}
      {!ready && collection && (
        <PreparationNotice
          key={collection.id}
          projectId={projectId}
          collection={collection}
        />
      )}
      <div className={notebook.surface}>
        <div className={notebook.pad}>
          <SourcesPanel
            projectId={projectId}
            collectionId={collectionId}
            readOnly={collection?.read_only ?? false}
            ready={ready}
            active={active}
            uploads={uploads}
          />
        </div>
      </div>
      {collection && (
        <RetrievalExperiment
          key={collection.id}
          projectId={projectId}
          collection={collection}
          indexing={uploads.rows.some(
            (row) =>
              row.collectionId === collectionId &&
              (row.status === "queued" || row.status === "uploading"),
          )}
        />
      )}
    </>
  );
}

function PreparationNotice({
  projectId,
  collection,
}: {
  projectId: string;
  collection: Collection;
}) {
  const resume = useResumeCollection(projectId, collection.id);
  return (
    <div className={notebook.note}>
      <p role="status">
        {collection.setup_error ||
          "This collection is still being prepared or its last preparation was interrupted."}
      </p>
      <Button
        help="Resume this collection's interrupted preparation. Previously prepared source versions are reused rather than duplicated."
        variant="secondary"
        size="sm"
        disabled={resume.isPending}
        onClick={() => resume.mutate()}
      >
        <RotateCcw size={14} />
        {resume.isPending
          ? "Preparing collection…"
          : "Retry collection preparation"}
      </Button>
      <ErrorNotice error={resume.error} />
    </div>
  );
}
