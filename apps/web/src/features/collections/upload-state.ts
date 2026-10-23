import type { UploadResult } from "@/lib/contracts";
export type UploadRow = {
  id: string;
  collectionId: string;
  file: File;
  status: "queued" | "uploading" | "ready" | "failed" | "invalid";
  error?: string;
  result?: UploadResult;
};
export type UploadAction =
  | { type: "add"; rows: UploadRow[] }
  | {
      type: "update";
      id: string;
      patch: Partial<Pick<UploadRow, "status" | "error" | "result">>;
    }
  | { type: "clear"; collectionId: string };
export function uploadReducer(
  state: UploadRow[],
  action: UploadAction,
): UploadRow[] {
  switch (action.type) {
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
