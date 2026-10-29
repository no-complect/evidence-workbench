-- Local credentials are encrypted; these tables have no browser grants.
CREATE TABLE provider_connections (
  id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id),
  user_id uuid NOT NULL, name text NOT NULL, provider text NOT NULL CHECK(provider='openai'),
  encrypted_key text, active boolean NOT NULL DEFAULT true,
  catalog jsonb NOT NULL DEFAULT '[]', discovered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,project_id)
);
CREATE TABLE provider_verifications (
  id uuid PRIMARY KEY, project_id uuid NOT NULL, connection_id uuid NOT NULL,
  user_id uuid NOT NULL, request jsonb NOT NULL, idempotency_key uuid NOT NULL,
  status text NOT NULL CHECK(status IN ('checking','verified','failed','uncertain')),
  error text, estimated_cost numeric NOT NULL, actual_cost numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(connection_id,project_id) REFERENCES provider_connections(id,project_id),
  UNIQUE(project_id,user_id,idempotency_key), UNIQUE(id,project_id)
);
CREATE TABLE harness_revisions (
  id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), user_id uuid NOT NULL,
  name text NOT NULL, idempotency_key uuid NOT NULL, request jsonb NOT NULL,
  snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id,user_id,idempotency_key), UNIQUE(id,project_id)
);
CREATE FUNCTION preserve_harness_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Harness revisions are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER immutable_harness_revision BEFORE UPDATE OR DELETE ON harness_revisions
  FOR EACH ROW EXECUTE FUNCTION preserve_harness_revision();
ALTER TABLE research_runs ADD COLUMN harness_snapshot jsonb;
ALTER TABLE provider_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE harness_revisions ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION preserve_run_harness() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.harness_snapshot IS DISTINCT FROM OLD.harness_snapshot THEN
    RAISE EXCEPTION 'Run harness snapshots are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_run_harness BEFORE UPDATE OF harness_snapshot ON research_runs
  FOR EACH ROW EXECUTE FUNCTION preserve_run_harness();
