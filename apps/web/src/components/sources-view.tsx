"use client";
import { useRef } from "react";
import {
  Database,
  FileText,
  Loader2,
  Plus,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { Button } from "./ui/button";
import { Empty } from "./empty";
import type { Source } from "@/lib/api";

export function SourcesView({
  sources,
  canCreate,
  canUpload,
  busy,
  onCreate,
  onUpload,
}: {
  sources: Source[];
  canCreate: boolean;
  canUpload: boolean;
  busy: boolean;
  onCreate: () => void;
  onUpload: (file: File) => void;
}) {
  const uploadRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <div className="section-title">
        <div>
          <h2>Source collection</h2>
          <p>Markdown, plain text, and text-based PDFs · up to 8 MiB.</p>
        </div>
        <div className="flex-row">
          <Button
            variant="secondary"
            size="sm"
            onClick={onCreate}
            disabled={!canCreate}
          >
            <Plus size={14} />
            Collection
          </Button>
          <Button
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
            accept=".md,.txt,.pdf"
            className="sr-only"
            aria-label="Upload source file"
            onChange={(e) => {
              if (e.target.files?.[0]) onUpload(e.target.files[0]);
              e.target.value = "";
            }}
          />
        </div>
      </div>
      <div className="source-note">
        <ShieldCheck size={16} />
        <span>
          Sources keep immutable versions. New demo uploads use full-text
          search; only seeded passages have fixture vectors. Scanned PDFs
          require OCR, which is unavailable.
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
                <th>Chunks</th>
                <th>Versions</th>
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
                        {s.error && <p className="source-error">{s.error}</p>}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`status-badge ${s.status}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="mono">{s.chunk_count}</td>
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
