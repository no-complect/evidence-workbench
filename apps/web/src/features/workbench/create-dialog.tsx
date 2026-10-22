"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ErrorNotice } from "@/components/error-notice";
import { useCreateCollection, useCreateProject } from "./mutations";

type Props = { onClose: () => void; onCreated: (id: string) => void } & (
  | { kind: "project" }
  | { kind: "collection"; projectId: string; liveEnabled: boolean }
);

function NameField({
  name,
  onChange,
  placeholder,
}: {
  name: string;
  onChange: (name: string) => void;
  placeholder: string;
}) {
  return (
    <label>
      Name
      <input
        data-autofocus
        required
        minLength={1}
        maxLength={100}
        value={name}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function ProjectForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const create = useCreateProject();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!create.isPending && name.trim())
          create.mutate(name.trim(), {
            onSuccess: (project) => onCreated(project.id),
          });
      }}
    >
      <NameField
        name={name}
        onChange={setName}
        placeholder="e.g. Infrastructure decisions"
      />
      <ErrorNotice error={create.error} onDismiss={create.reset} />
      <Button type="submit" disabled={create.isPending || !name.trim()}>
        {create.isPending && <Loader2 size={14} className="spin" />}Create
        project
      </Button>
    </form>
  );
}

function CollectionForm({
  projectId,
  liveEnabled,
  onCreated,
}: {
  projectId: string;
  liveEnabled: boolean;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [embedding, setEmbedding] = useState("demo-v1");
  const create = useCreateCollection(projectId);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!create.isPending && name.trim())
          create.mutate(
            { name: name.trim(), embedding_config: embedding },
            { onSuccess: (collection) => onCreated(collection.id) },
          );
      }}
    >
      <NameField
        name={name}
        onChange={setName}
        placeholder="e.g. Security review pack"
      />
      <label>
        Embedding profile
        <select
          value={embedding}
          onChange={(event) => setEmbedding(event.target.value)}
        >
          <option value="demo-v1">Fixture vectors v1 · 16 dimensions</option>
          <option value="openai-small-v1" disabled={!liveEnabled}>
            OpenAI small v1 · 1536 dimensions
            {!liveEnabled && " · not configured"}
          </option>
        </select>
      </label>
      <p className="fine-print">
        The collection owns its embedding profile independently of the research
        form. Changing embedding models requires a new collection. Unseeded demo
        uploads use full-text search.
      </p>
      <ErrorNotice error={create.error} onDismiss={create.reset} />
      <Button type="submit" disabled={create.isPending || !name.trim()}>
        {create.isPending && <Loader2 size={14} className="spin" />}Create
        collection
      </Button>
    </form>
  );
}

export function CreateDialog(props: Props) {
  return (
    <Modal
      label={`New ${props.kind}`}
      className="modal"
      onClose={props.onClose}
    >
      <div className="section-title">
        <h2>New {props.kind}</h2>
        <button type="button" aria-label="Close dialog" onClick={props.onClose}>
          <X size={18} />
        </button>
      </div>
      {props.kind === "project" ? (
        <ProjectForm onCreated={props.onCreated} />
      ) : (
        <CollectionForm
          projectId={props.projectId}
          liveEnabled={props.liveEnabled}
          onCreated={props.onCreated}
        />
      )}
    </Modal>
  );
}
