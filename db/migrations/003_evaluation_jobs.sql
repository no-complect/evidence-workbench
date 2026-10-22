-- Durable evaluation scheduling is independent of research-run execution.
ALTER TABLE collections ADD COLUMN read_only boolean NOT NULL DEFAULT false;
CREATE TABLE evaluation_jobs (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects,
  user_id uuid NOT NULL,
  collection_id uuid NOT NULL,
  request jsonb NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued','running','completed','failed','cancelled')),
  progress jsonb NOT NULL DEFAULT '{}',
  result_id uuid,
  cancel_requested boolean NOT NULL DEFAULT false,
  error text,
  lease_owner text,
  lease_until timestamptz,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,project_id),
  UNIQUE(project_id,user_id,idempotency_key)
);
ALTER TABLE evaluation_runs ADD CONSTRAINT evaluation_run_scope UNIQUE(id,project_id);
ALTER TABLE evaluation_jobs ADD CONSTRAINT evaluation_result_scope_fk
  FOREIGN KEY(result_id,project_id) REFERENCES evaluation_runs(id,project_id);
CREATE UNIQUE INDEX evaluation_jobs_one_active_project ON evaluation_jobs(project_id)
  WHERE status IN ('queued','running');
CREATE INDEX evaluation_jobs_queue ON evaluation_jobs(created_at)
  WHERE status IN ('queued','running');
ALTER TABLE research_runs ADD COLUMN evaluation_job_id uuid;
ALTER TABLE research_runs ADD CONSTRAINT run_evaluation_scope_fk
  FOREIGN KEY(evaluation_job_id,project_id) REFERENCES evaluation_jobs(id,project_id);
CREATE INDEX research_runs_evaluation ON research_runs(evaluation_job_id)
  WHERE evaluation_job_id IS NOT NULL;
ALTER TABLE evaluation_runs ADD COLUMN raw jsonb NOT NULL DEFAULT '[]';
-- These jobs remain behind the membership-checked API, including on Supabase.
ALTER TABLE evaluation_jobs ENABLE ROW LEVEL SECURITY;
