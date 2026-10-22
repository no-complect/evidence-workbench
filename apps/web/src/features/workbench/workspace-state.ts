export type WorkspaceTab =
  "report" | "evidence" | "activity" | "context" | "sources" | "evaluations";
export type WorkspaceOverlay =
  | { kind: "create-project" }
  | { kind: "create-collection" }
  | { kind: "evidence"; evidenceId: string }
  | null;
export type WorkspaceState = {
  runId: string;
  collectionId: string;
  tab: WorkspaceTab;
  overlay: WorkspaceOverlay;
};
export type WorkspaceAction =
  | { type: "navigate"; tab: WorkspaceTab }
  | { type: "select-run"; runId: string }
  | { type: "started-run"; runId: string }
  | { type: "new-investigation" }
  | { type: "select-collection"; collectionId: string }
  | { type: "show-overlay"; overlay: WorkspaceOverlay };
export const initialWorkspaceState: WorkspaceState = {
  runId: "",
  collectionId: "",
  tab: "report",
  overlay: null,
};

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case "navigate":
      return { ...state, tab: action.tab, overlay: null };
    case "select-run":
      return { ...state, runId: action.runId, tab: "report", overlay: null };
    case "started-run":
      return { ...state, runId: action.runId, tab: "activity", overlay: null };
    case "new-investigation":
      return { ...state, runId: "", tab: "report", overlay: null };
    case "select-collection":
      return { ...state, collectionId: action.collectionId, overlay: null };
    case "show-overlay":
      return { ...state, overlay: action.overlay };
  }
}

// Store selection intent, derive the selected record from authoritative query data.
export function resolveSelection<T extends { id: string }>(
  items: T[],
  id: string,
): T | undefined {
  return items.find((item) => item.id === id) ?? items[0];
}
