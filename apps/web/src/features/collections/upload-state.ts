export type UploadRow = {
  id: string;
  collectionId: string;
  file: File;
  status: "queued" | "uploading" | "failed" | "invalid";
  error?: string;
};

export type UploadAction =
  | { type: "add"; rows: UploadRow[] }
  | {
      type: "update";
      id: string;
      patch: Partial<Pick<UploadRow, "status" | "error">>;
    }
  | { type: "clear"; collectionId: string }
  | { type: "submitted"; id: string };

export function uploadReducer(
  state: UploadRow[],
  action: UploadAction,
): UploadRow[] {
  switch (action.type) {
    case "submitted":
      return state.filter((row) => row.id !== action.id);
    case "add":
      return [...state, ...action.rows];
    case "update":
      return state.map((row) =>
        row.id === action.id ? { ...row, ...action.patch } : row,
      );
    case "clear":
      return state.filter(
        (row) =>
          row.collectionId !== action.collectionId ||
          row.status === "queued" ||
          row.status === "uploading",
      );
  }
}
