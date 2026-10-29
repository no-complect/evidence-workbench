-- A reservation is committed before inference; ambiguous calls are never replayed.
CREATE TABLE evaluation_judgments (
  id uuid PRIMARY KEY,
  evaluation_job_id uuid NOT NULL,
  project_id uuid NOT NULL,
  run_id uuid NOT NULL,
  claim_index int NOT NULL CHECK(claim_index >= 0),
  request jsonb NOT NULL,
  status text NOT NULL CHECK(status IN ('reserved','graded','ungraded')),
  result jsonb NOT NULL DEFAULT '{}',
  token_bound int NOT NULL CHECK(token_bound >= 0),
  tokens_charged int NOT NULL CHECK(tokens_charged >= 0),
  cost_charged numeric NOT NULL CHECK(cost_charged >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(evaluation_job_id,run_id,claim_index),
  FOREIGN KEY(evaluation_job_id,project_id) REFERENCES evaluation_jobs(id,project_id),
  FOREIGN KEY(run_id,project_id) REFERENCES research_runs(id,project_id)
);
CREATE INDEX evaluation_judgments_job ON evaluation_judgments(evaluation_job_id,created_at);
ALTER TABLE evaluation_judgments ENABLE ROW LEVEL SECURITY;
-- There are no direct browser grants; the membership-checked API exposes results.
CREATE FUNCTION preserve_judgment_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'reserved' OR NEW.request IS DISTINCT FROM OLD.request
    OR NEW.evaluation_job_id <> OLD.evaluation_job_id OR NEW.project_id <> OLD.project_id
    OR NEW.run_id <> OLD.run_id OR NEW.claim_index <> OLD.claim_index
    OR NEW.token_bound <> OLD.token_bound OR NEW.id <> OLD.id
    OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Saved judge boundaries and final grades are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_judgment_boundary BEFORE UPDATE ON evaluation_judgments
  FOR EACH ROW EXECUTE FUNCTION preserve_judgment_boundary();
