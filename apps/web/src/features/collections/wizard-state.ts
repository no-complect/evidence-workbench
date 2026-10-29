import type { CollectionSetup } from "../../../../../packages/contracts/models";

export type CollectionDraft = Pick<
  CollectionSetup,
  "name" | "purpose" | "source_kind" | "embedding_config"
>;

export const initialCollectionDraft: CollectionDraft = {
  name: "Architecture review",
  purpose: "security retention",
  source_kind: "starter",
  embedding_config: "demo-v1",
};

export function collectionRequest(
  draft: CollectionDraft,
  key: string,
): CollectionSetup {
  const name = draft.name.trim(),
    purpose = draft.purpose.trim();
  if (!name || name.length > 100)
    throw new Error("Enter a collection name of 1–100 characters.");
  if (purpose.length < 3 || purpose.length > 1000)
    throw new Error("Describe the decision in 3–1,000 characters.");
  return {
    ...draft,
    name,
    purpose,
    embedding_config:
      draft.source_kind === "starter" ? "demo-v1" : draft.embedding_config,
    idempotency_key: key,
  };
}
