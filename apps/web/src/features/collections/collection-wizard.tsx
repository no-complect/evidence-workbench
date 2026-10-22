"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCheck, FolderPlus, Loader2, X } from "lucide-react";
import type { Collection } from "@/lib/contracts";
import { MAX_BATCH_FILES, sourceFileError } from "@/lib/ingestion";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/error-notice";
import {
  submissionIntent,
  type SubmissionIntent,
} from "@/features/workbench/research-state";
import { collectionOptions, usePrepareCollection } from "./queries";
import {
  collectionRequest,
  initialCollectionDraft,
  type CollectionDraft,
} from "./wizard-state";
import type { UploadQueue } from "./use-upload-queue";
import { UploadBatch } from "./upload-batch";
import { RetrievalExperiment } from "./retrieval-experiment";
import styles from "./collections.module.css";
import notebook from "@/features/workbench/notebook.module.css";

const steps = ["Purpose", "Sources", "Review", "Try it"];
export function CollectionWizard({
  projectId,
  collections,
  uploads,
  onClose,
  onFinished,
}: {
  projectId: string;
  collections: Collection[];
  uploads: UploadQueue;
  onClose: () => void;
  onFinished: (id: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<CollectionDraft>(initialCollectionDraft);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [createdId, setCreatedId] = useState("");
  const intent = useRef<SubmissionIntent | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const options = useQuery(collectionOptions(projectId));
  const prepare = usePrepareCollection(projectId);
  const collection =
    collections.find((item) => item.id === createdId) ?? prepare.data;
  const busy = prepare.isPending || uploads.busy;
  useEffect(() => {
    if (step === 0) nameRef.current?.focus();
    else headingRef.current?.focus();
  }, [step]);
  function next() {
    setError("");
    try {
      collectionRequest(draft, "validation-only");
      if (step === 1 && draft.source_kind === "upload") {
        if (!files.length)
          throw new Error("Select the documents you want to upload.");
        if (files.length > MAX_BATCH_FILES)
          throw new Error(`Choose at most ${MAX_BATCH_FILES} files.`);
        if (!files.some((file) => !sourceFileError(file)))
          throw new Error(
            "Choose at least one supported, nonempty file up to 8 MiB.",
          );
      }
      setStep((previous) => previous + 1);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Review the collection settings.",
      );
    }
  }
  async function create() {
    if (busy) return;
    setError("");
    try {
      const request = collectionRequest(draft, "pending");
      const { idempotency_key: _key, ...body } = request;
      intent.current = submissionIntent(intent.current, body, () =>
        crypto.randomUUID(),
      );
      const created = await prepare.mutateAsync({
        ...body,
        idempotency_key: intent.current.key,
      });
      setCreatedId(created.id);
      setStep(3);
      if (draft.source_kind === "upload") await uploads.add(created.id, files);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Preparation failed. Retry the same request to resume.",
      );
    }
  }
  return (
    <Modal
      label="Create an evidence collection"
      className={`modal ${styles.wizard}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className={styles.wizardHeader}>
        <h2>
          <FolderPlus size={20} />
          Create an evidence collection
        </h2>
        <button
          type="button"
          aria-label="Close collection walkthrough"
          disabled={busy}
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      <ol className={styles.steps} aria-label="Collection setup">
        {steps.map((label, index) => (
          <li key={label} aria-current={step === index ? "step" : undefined}>
            <span>{index < step ? <CheckCheck size={13} /> : index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (step < 2) next();
          else if (step === 2) void create();
        }}
      >
        {step === 0 && (
          <>
            <h3>What will this collection help you decide?</h3>
            <div className={styles.fields}>
              <label className={styles.field}>
                Collection name
                <input
                  ref={nameRef}
                  data-autofocus
                  required
                  maxLength={100}
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      name: event.target.value,
                    }))
                  }
                />
              </label>
              <label className={styles.field}>
                Decision or research question
                <textarea
                  required
                  minLength={3}
                  maxLength={1000}
                  rows={3}
                  value={draft.purpose}
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      purpose: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <div className={notebook.note}>
              You do not need to generate a dataset. Bring requirements,
              policies, architecture notes, runbooks, or cost assumptions—or
              start with the bundled synthetic documents.
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <h3 ref={headingRef} tabIndex={-1}>
              Start with useful material.
            </h3>
            <label className={styles.choice}>
              <input
                type="radio"
                name="collection-material"
                checked={draft.source_kind === "starter"}
                onChange={() =>
                  setDraft((previous) => ({
                    ...previous,
                    source_kind: "starter",
                    embedding_config: "demo-v1",
                  }))
                }
              />
              <span>
                Use the synthetic architecture pack
                <small>
                  {options.data?.documents.length ?? "Bundled"} documents
                  covering deployment, security, operations, quality, and
                  deliberately difficult evidence. Fixture vectors · 16
                  dimensions · no paid calls.
                </small>
              </span>
            </label>
            <label className={styles.choice}>
              <input
                type="radio"
                name="collection-material"
                checked={draft.source_kind === "upload"}
                onChange={() =>
                  setDraft((previous) => ({
                    ...previous,
                    source_kind: "upload",
                  }))
                }
              />
              <span>
                Bring my own documents
                <small>
                  Markdown, UTF-8 text, or text-based PDF. Up to 8 MiB per file,
                  20 files per batch. Scanned PDFs require OCR, which is
                  unavailable.
                </small>
              </span>
            </label>
            {draft.source_kind === "upload" && (
              <div className={styles.fields}>
                <label className={styles.field}>
                  Collection source files
                  <input
                    type="file"
                    multiple
                    accept=".md,.txt,.pdf"
                    onChange={(event) => {
                      setFiles(Array.from(event.target.files ?? []));
                      setError("");
                    }}
                  />
                </label>
                <label className={styles.field}>
                  Embedding profile
                  <select
                    value={draft.embedding_config}
                    onChange={(event) =>
                      setDraft((previous) => ({
                        ...previous,
                        embedding_config: event.target
                          .value as CollectionDraft["embedding_config"],
                      }))
                    }
                  >
                    <option value="demo-v1">
                      Keyword search · fixture-compatible index
                    </option>
                    <option
                      value="openai-small-v1"
                      disabled={!options.data?.live_embeddings}
                    >
                      OpenAI small · 1536 dimensions
                      {!options.data?.live_embeddings && " · not configured"}
                    </option>
                  </select>
                </label>
                <p className="fine-print">
                  Custom uploads in the fixture-compatible index have no
                  generated vectors. Live embeddings use the configured server
                  provider. An embedding model change requires a new collection.
                </p>
              </div>
            )}
          </>
        )}
        {step === 2 && (
          <>
            <h3 ref={headingRef} tabIndex={-1}>
              Review what will be ingested.
            </h3>
            <p className={styles.reviewTitle}>
              {draft.name} · {draft.embedding_config}
            </p>
            <p className="fine-print">{draft.purpose}</p>
            <ul className={styles.files}>
              {draft.source_kind === "starter"
                ? options.data?.documents.map((file) => (
                    <li key={file.name}>
                      <strong>{file.name}</strong>
                      <span>
                        {Math.ceil(file.bytes / 1024)} KiB · synthetic
                      </span>
                    </li>
                  ))
                : files.map((file, index) => (
                    <li key={index}>
                      <div>
                        <strong>{file.name}</strong>
                        <span>{Math.ceil(file.size / 1024)} KiB</span>
                        {sourceFileError(file) && (
                          <p className="source-error">
                            {sourceFileError(file)}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
            </ul>
            <div className={notebook.note}>
              {draft.source_kind === "starter"
                ? "The server prepares the real bundled documents and fixture vectors. Retrying an interrupted preparation resumes the same collection."
                : "Supported files upload and index one at a time. Invalid files are skipped and server-side extraction errors remain visible per file. Live indexing calls your configured embedding provider."}
            </div>
          </>
        )}
        {step < 3 && (
          <>
            <ErrorNotice error={error || prepare.error} />
            <ErrorNotice
              error={options.error}
              onRetry={() => void options.refetch()}
            />
            {options.isPending && <p role="status">Loading source options…</p>}
            <div className={styles.actions}>
              <Button
                variant="secondary"
                disabled={step === 0 || busy}
                onClick={() => {
                  setError("");
                  setStep((previous) => previous - 1);
                }}
              >
                Back
              </Button>
              <Button
                type="submit"
                disabled={busy || (step > 0 && !options.isSuccess)}
              >
                {prepare.isPending && <Loader2 size={15} className="spin" />}
                {step === 0
                  ? "Choose sources"
                  : step === 1
                    ? "Review sources"
                    : prepare.isPending
                      ? "Preparing collection…"
                      : "Prepare collection"}
                <ArrowRight size={14} />
              </Button>
            </div>
          </>
        )}
      </form>
      {step === 3 && collection && (
        <>
          <h3 ref={headingRef} tabIndex={-1}>
            Your collection is ready to inspect.
          </h3>
          <p className="fine-print">
            Preparation status is shown below. Search uses the actual indexed
            passages; retrieval quality and supported answers are separate
            checks.
          </p>
          <UploadBatch queue={uploads} collectionId={createdId} />
          <label className={styles.field}>
            Add more collection files
            <input
              type="file"
              multiple
              accept=".md,.txt,.pdf"
              disabled={busy}
              onChange={(event) => {
                void uploads.add(
                  createdId,
                  Array.from(event.target.files ?? []),
                );
                event.target.value = "";
              }}
            />
          </label>
          <RetrievalExperiment
            projectId={projectId}
            collection={collection}
            indexing={uploads.busy}
          />
          <div className={styles.actions}>
            <span className="fine-print">
              Files needing correction can be selected again. Your prepared
              collection remains saved.
            </span>
            <Button disabled={busy} onClick={() => onFinished(createdId)}>
              Finish setup
              <CheckCheck size={15} />
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
