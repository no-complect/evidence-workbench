"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ErrorNotice } from "@/components/error-notice";
import { useCreateProject } from "./mutations";

type Props = {
  kind: "project";
  onClose: () => void;
  onCreated: (id: string) => void;
};

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
      <ProjectForm onCreated={props.onCreated} />
    </Modal>
  );
}
