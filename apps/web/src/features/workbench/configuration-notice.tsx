export function ConfigurationNotice({
  issues,
  blocking = true,
}: {
  issues: string[];
  blocking?: boolean;
}) {
  if (!issues.length) return null;
  return (
    <div
      className={`${styles.notice} ${blocking ? styles.blocking : ""}`}
      role={blocking ? "alert" : "status"}
    >
      {blocking ? (
        <Settings2 size={20} aria-hidden="true" />
      ) : (
        <Info size={20} aria-hidden="true" />
      )}
      <div className={styles.content}>
        <h2>
          {blocking
            ? "Workspace setup is incomplete"
            : "Some AI features are unavailable"}
        </h2>
        <p>
          {blocking
            ? "An environment setting needs attention before this workspace can connect."
            : "You can continue using the available workspace features."}
        </p>
        <details>
          <summary>Setup details</summary>
          <ul>
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
          <p className="fine-print">
            Update the environment, then restart the affected services. Changes
            to NEXT_PUBLIC_ settings require rebuilding or redeploying the web
            app. For a shared deployment, contact the workspace administrator.
          </p>
        </details>
      </div>
    </div>
  );
}
import { Info, Settings2 } from "lucide-react";
import styles from "./configuration-notice.module.css";
