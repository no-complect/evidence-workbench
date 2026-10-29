import { X } from "lucide-react";
import { Button } from "./ui/button";

export function ErrorNotice({
  error,
  title = "Action could not complete",
  onRetry,
  onDismiss,
}: {
  error: Error | string | null | undefined;
  title?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  if (!error) return null;
  return (
    <div className="error-banner" role="alert">
      <div>
        <strong>{title}</strong>
        <p>{typeof error === "string" ? error : error.message}</p>
      </div>
      {onRetry && (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
      {onDismiss && (
        <button type="button" aria-label="Dismiss error" onClick={onDismiss}>
          <X size={17} />
        </button>
      )}
    </div>
  );
}
