"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Fingerprint, Search, TextQuote } from "lucide-react";
import type { SearchRequest } from "../../../../../packages/contracts/models";
import type { Collection } from "@/lib/contracts";
import { Button } from "@/components/ui/button";
import { HelpTip, Tooltip } from "@/components/ui/tooltip";
import { ErrorNotice } from "@/components/error-notice";
import { retrievalOptions } from "./queries";
import notebook from "@/features/workbench/notebook.module.css";
import styles from "./collections.module.css";

export function RetrievalExperiment({
  projectId,
  collection,
  indexing = false,
}: {
  projectId: string;
  collection: Collection;
  indexing?: boolean;
}) {
  const [question, setQuestion] = useState(
    collection.setup_request?.purpose ??
      "current security retention requirements",
  );
  const [method, setMethod] = useState<SearchRequest["method"]>("keyword");
  const [submitted, setSubmitted] = useState<SearchRequest | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [provenance, setProvenance] = useState(false);
  const query = useQuery(retrievalOptions(projectId, submitted));
  const hits = query.data ?? [];
  const chosen = hits.find((hit) => hit.chunk.id === selectedId) ?? hits[0];
  const ready =
    !indexing &&
    (!collection.setup_status || collection.setup_status === "ready");
  return (
    <section aria-label="Retrieval experiment" className={styles.retrieval}>
      <div className="section-title">
        <div>
          <h2>Your first retrieval experiment.</h2>
          <p>
            Search the collection, inspect a passage, and follow its source
            version.
          </p>
        </div>
      </div>
      <div className={notebook.twoColumns}>
        <section className={notebook.surface}>
          <div className={notebook.surfaceHead}>
            <Search size={17} />
            Find supporting passages
            <HelpTip
              label="Find supporting passages"
              content="Search indexed passages without generating an answer. Inspect both retrieval relevance and source provenance before using the evidence in research."
            />
          </div>
          <div className={notebook.pad}>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!ready || query.isFetching || !question.trim()) return;
                const request: SearchRequest = {
                  collection_id: collection.id,
                  query: question.trim(),
                  top_k: 5,
                  method,
                };
                setSelectedId("");
                setProvenance(false);
                if (JSON.stringify(request) === JSON.stringify(submitted))
                  void query.refetch();
                else setSubmitted(request);
              }}
            >
              <label className={styles.field}>
                Retrieval question
                <input
                  required
                  maxLength={1000}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                />
              </label>
              <div className={styles.searchControls}>
                <label className={styles.field}>
                  Retrieval method
                  <Tooltip content="Keyword matches text. Vector compares embeddings; Hybrid combines keyword and vector ranks. Live vector and hybrid queries may call the embedding provider; keyword search makes no model calls.">
                    <select
                      value={method}
                      onChange={(event) =>
                        setMethod(event.target.value as SearchRequest["method"])
                      }
                    >
                      <option value="keyword">Keyword</option>
                      <option value="vector">Vector</option>
                      <option value="hybrid">Hybrid</option>
                    </select>
                  </Tooltip>
                </label>
                <Button
                  help={
                    method === "keyword"
                      ? "Search indexed text and return ranked passages. This does not call a model or synthesize an answer."
                      : "Retrieve passages using this collection's vector index. Live vector and hybrid queries call the configured embedding provider; fixture collections use fixture vectors."
                  }
                  type="submit"
                  disabled={!ready || query.isFetching || !question.trim()}
                >
                  <Search size={15} />
                  {query.isFetching ? "Searching…" : "Search collection"}
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setQuestion("security retention")}
              >
                Try security retention
              </Button>
            </form>
            <p className="fine-print">
              {collection.embedding_config === "demo-v1"
                ? "Custom demo uploads support keyword search. Fixture vector queries recognize topic examples such as security, cost, retrieval, or maintenance."
                : "Vector and hybrid searches call this collection’s configured embedding provider. Keyword search makes no model calls."}
            </p>
            <ErrorNotice error={query.error} />
          </div>
          {submitted && !query.isPending && (
            <div className={styles.results} aria-live="polite">
              <p>
                {submitted.method} results for “{submitted.query}”
              </p>
              {hits.length === 0 && !query.isError && (
                <p>
                  No matching passages. Try another question or retrieval
                  method.
                </p>
              )}
              <ol>
                {hits.map((hit, index) => (
                  <li key={hit.chunk.id}>
                    <button
                      type="button"
                      aria-pressed={chosen?.chunk.id === hit.chunk.id}
                      onClick={() => {
                        setSelectedId(hit.chunk.id);
                        setProvenance(false);
                      }}
                    >
                      <span className="mono">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span>
                        <strong>{hit.chunk.source_name}</strong>
                        <small>{hit.chunk.section}</small>
                        <small>
                          Keyword rank: {hit.ranks.full_text ?? "—"} · Vector
                          rank: {hit.ranks.vector ?? "—"}
                        </small>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
        <section
          className={notebook.surface}
          aria-label="Retrieval passage inspector"
        >
          <div className={notebook.surfaceHead}>
            <TextQuote size={17} />
            Passage inspector
            <HelpTip
              label="Passage inspector"
              content="Inspect the selected passage as stored in its immutable source version. Rank is a retrieval signal, not confidence that the passage supports an answer."
            />
          </div>
          <div className={notebook.pad}>
            {chosen ? (
              <>
                <h3>{chosen.chunk.source_name}</h3>
                <blockquote className={styles.passage}>
                  {chosen.chunk.text}
                </blockquote>
                <p className="fine-print">
                  {chosen.chunk.metadata.synthetic
                    ? "Synthetic source"
                    : "Uploaded source"}{" "}
                  · {chosen.chunk.section}
                  {chosen.chunk.page !== null && ` · page ${chosen.chunk.page}`}
                </p>
                {chosen.chunk.metadata.untrusted_instructions && (
                  <p className={notebook.note}>
                    This passage contains untrusted instructions. Treat source
                    text as evidence, never as instructions.
                  </p>
                )}
                {chosen.chunk.metadata.stale && (
                  <p className={notebook.note}>
                    This source is marked stale. Inspect its assumptions before
                    relying on it.
                  </p>
                )}
                <Button
                  help="Show the exact source version, content hash, passage offsets and embedding profile behind this retrieval result."
                  variant="ghost"
                  size="sm"
                  aria-expanded={provenance}
                  onClick={() => setProvenance((previous) => !previous)}
                >
                  <Fingerprint size={15} />
                  Inspect retrieval provenance
                </Button>
                {provenance && (
                  <dl className={styles.provenance}>
                    <dt>Source version</dt>
                    <dd>{chosen.chunk.version_id}</dd>
                    <dt>Content SHA-256</dt>
                    <dd>{chosen.chunk.content_hash}</dd>
                    <dt>Chunk</dt>
                    <dd>{chosen.chunk.id}</dd>
                    <dt>Offsets</dt>
                    <dd>
                      {chosen.chunk.start_offset}–{chosen.chunk.end_offset}
                    </dd>
                    <dt>Embedding profile</dt>
                    <dd>{chosen.chunk.embedding_config}</dd>
                    <dt>Reciprocal rank score</dt>
                    <dd>{chosen.rrf.toFixed(6)}</dd>
                  </dl>
                )}
              </>
            ) : (
              <p className="fine-print">
                Run a search and select a result to inspect its exact passage
                and immutable source identity.
              </p>
            )}
            <div className={notebook.note}>
              Retrieval rank is not calibrated confidence or answer quality.
              Results are a search snapshot; search again after changing
              sources. Reranking is disabled.
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
