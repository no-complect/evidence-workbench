"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileJson } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/tooltip";
import { ErrorNotice } from "@/components/error-notice";
import type { InspectorStage } from "./contracts";
import { studioOptions, useContractValidation } from "./queries";
import styles from "./studio.module.css";
const samples: Record<InspectorStage, unknown> = {
  judge: {
    label: "insufficient",
    reason: "The cited passage does not establish the stated cost comparison.",
  },
  report: {
    title: "Deployment review",
    summary: "A conditional recommendation",
    claims: [],
    limitations: ["Comparable cost evidence is missing"],
    recommendations: [],
    partial: false,
  },
  plan: {
    tasks: [
      {
        id: "security",
        topic: "security",
        question: "Which security requirements apply?",
      },
    ],
    rationale: "Inspect the source requirements first.",
  },
  assess: {
    covered: ["security"],
    gaps: ["Comparable costs missing"],
    contradictions: [],
    followups: [],
  },
};
export function ContractPreview({
  projectId,
  active,
}: {
  projectId: string;
  active: boolean;
}) {
  const studio = useQuery(studioOptions(projectId, active));
  const [stage, setStage] = useState<InspectorStage>("report");
  const [json, setJson] = useState(JSON.stringify(samples.report, null, 2));
  const validate = useContractValidation(projectId);
  function changeStage(next: InspectorStage) {
    setStage(next);
    setJson(JSON.stringify(samples[next], null, 2));
    validate.reset();
  }
  return (
    <section className={styles.surface} aria-label="Contract preview">
      <div className={styles.head}>
        <span>
          <FileJson size={16} />
          Contract preview
          <HelpTip
            label="Contract preview"
            content="Inspect and validate the output structure expected by each stage. Schema validation makes no model calls and does not establish factual correctness."
          />
        </span>
        <small>Server-validated schema</small>
      </div>
      <div className={styles.pad}>
        <label className={styles.field}>
          Output contract
          <select
            aria-label="Output contract"
            value={stage}
            onChange={(e) => changeStage(e.target.value as InspectorStage)}
          >
            <option value="report">Cited research report</option>
            <option value="plan">Research plan</option>
            <option value="assess">Evidence assessment & routing</option>
            <option value="judge">Semantic claim judgment</option>
          </select>
        </label>
        <div className={styles.contract}>
          <div className={styles.label}>EXAMPLE OUTPUT · EDIT TO VALIDATE</div>
          <textarea
            className={`${styles.code} ${styles.editor}`}
            aria-label="Contract JSON"
            value={json}
            maxLength={16000}
            onChange={(e) => {
              setJson(e.target.value);
              validate.reset();
            }}
            spellCheck={false}
          />
        </div>
        <div className={styles.actions}>
          <Button
            help="Send this JSON to the server's stage schema validator. No inference is performed; valid structure does not prove that an answer is supported."
            variant="secondary"
            disabled={validate.isPending || !projectId}
            onClick={() => validate.mutate({ stage, payload: json })}
          >
            {validate.isPending ? "Validating…" : "Validate sample"}
          </Button>
          <Button
            help="Replace the editable example with deliberately invalid JSON structure so you can inspect validation failures."
            variant="ghost"
            onClick={() => {
              setJson('{"unexpected":true}');
              validate.reset();
            }}
          >
            Try invalid output
          </Button>
        </div>
        <ErrorNotice error={validate.error || studio.error} />
        <div className={styles.note} role="status">
          <FileJson size={17} />
          <div>
            <strong>
              {validate.data
                ? validate.data.valid
                  ? "Output matches the contract."
                  : "Output does not match the contract."
                : "Inspect the contract before running."}
            </strong>
            {validate.data && !validate.data.valid
              ? validate.data.errors.map((e, i) => (
                  <div key={i}>
                    {e.path || "JSON"} · {e.type}
                  </div>
                ))
              : "Validation uses the same Pydantic contract as the execution services. It makes no model calls and does not verify factual support."}
          </div>
        </div>
        <details className={styles.context}>
          <summary>Inspect the JSON schema</summary>
          <pre className={styles.code}>
            {JSON.stringify(studio.data?.schemas[stage] ?? {}, null, 2)}
          </pre>
        </details>
        <details className={styles.context}>
          <summary>Inspect the versioned stage instruction</summary>
          <pre className={styles.code}>
            {studio.data?.prompts[stage] ?? "Loading stage instruction…"}
          </pre>
        </details>
      </div>
      <div className={styles.annotation}>
        <strong>IMMUTABLE EXPERIMENTS</strong>Stage outputs have distinct
        contracts. This inspector selects a schema to inspect; the workflow
        services enforce the corresponding schema at each model boundary.
      </div>
    </section>
  );
}
