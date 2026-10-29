"use client";

import { useRef } from "react";

import { Database, FileText, Loader2, ShieldCheck, Upload } from "lucide-react";

import { Empty } from "@/components/empty";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/tooltip";
import type { Source } from "@/lib/api";

export function SourcesView({
  sources,
  canUpload,
  readOnly = false,
  busy,
  onUpload,
}: {
  sources: Source[];
  canUpload: boolean;
  readOnly?: boolean;
  busy: boolean;
  onUpload: (files: File[]) => void;
}) {
  const uploadRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <div className="section-title">
        <div>
          <h2>
            Source collection
            <HelpTip
              label="Source collection"
              content="Documents are extracted into passages and retain immutable versions. Reuploading identical bytes reuses a version; replacing a source does not change evidence already pinned to saved runs."
            />
          </h2>
          <p>Markdown, plain text, and text-based PDFs · up to 8 MiB.</p>
        </div>
        <div className="flex-row">
          <Button
            help="Upload Markdown, UTF-8 text or a text-based PDF to this collection. Live indexing may call the configured embedding provider. Scanned PDFs need OCR, which is unavailable."
            size="sm"
            onClick={() => uploadRef.current?.click()}
            disabled={!canUpload || busy}
          >
            {busy ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <Upload size={14} />
            )}
            Upload source
          </Button>
          <input
            ref={uploadRef}
            type="file"
            multiple
            accept=".md,.txt,.pdf"
            className="sr-only"
            aria-label="Upload source file"
            disabled={!canUpload || busy}
            onChange={(e) => {
              if (e.target.files?.length) onUpload(Array.from(e.target.files));
              e.target.value = "";
            }}
          />
        </div>
      </div>
      <div className="source-note">
        <ShieldCheck size={16} />
        <span>
          {readOnly ? (
            "This benchmark snapshot is read-only. Create a separate collection to upload your sources."
          ) : (
            <>
              Sources keep immutable versions. New demo uploads use full-text
              search; only seeded passages have fixture vectors. Scanned PDFs
              require OCR, which is unavailable.
            </>
          )}
        </span>
      </div>
      {sources.length === 0 ? (
        <Empty
          icon={Database}
          title="Build your evidence base"
          text="Create a collection and upload your first source. Content hashes make repeat uploads idempotent."
        />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>Status</th>
                <th>
                  Chunks
                  <HelpTip
                    label="Source chunks"
                    content="Number of indexed passages extracted from the current source version. A source can have searchable text even when it has no vectors."
                  />
                </th>
                <th>
                  Vectors
                  <HelpTip
                    label="Source vectors"
                    content="Passages with embeddings available for vector search. Custom fixture-mode uploads have keyword-searchable text but no generated vectors."
                  />
                </th>
                <th>
                  Versions
                  <HelpTip
                    label="Source versions"
                    content="Immutable content revisions retained for this document. Identical reuploads reuse a version instead of creating a duplicate."
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div className="source-name">
                      <FileText size={17} />
                      <div>
                        <strong>{s.name}</strong>
                        {s.error && (
                          <p className="source-error">
                            {s.error}
                            {s.current_version_id &&
                              " Previous source version is still available."}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`status-badge ${s.status}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="mono">{s.chunk_count}</td>
                  <td className="mono">{s.vector_chunk_count ?? "—"}</td>
                  <td className="mono">{s.version_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
