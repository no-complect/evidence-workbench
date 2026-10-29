-- Environment-based reusable drafts, separate from legacy verified connections.
CREATE TABLE harness_presets (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  user_id uuid NOT NULL,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
  settings jsonb NOT NULL,
  settings_hash text NOT NULL,
  schema_version int NOT NULL DEFAULT 1 CHECK(schema_version = 1),
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id,user_id,idempotency_key)
);
CREATE INDEX harness_presets_owner ON harness_presets(project_id,user_id,created_at DESC,id);
ALTER TABLE harness_presets ENABLE ROW LEVEL SECURITY;
-- No direct browser grants. Reads/writes use the membership-checked API.
CREATE FUNCTION preserve_harness_preset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Harness presets are immutable; save a new preset' USING ERRCODE='23514'; END $$;
CREATE TRIGGER immutable_harness_preset BEFORE UPDATE OR DELETE ON harness_presets
  FOR EACH ROW EXECUTE FUNCTION preserve_harness_preset();
