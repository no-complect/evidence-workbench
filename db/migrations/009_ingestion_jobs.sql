-- Staged uploads survive browser/API restarts. Only the API exposes safe projections.
CREATE TABLE ingestion_jobs (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL,
 collection_id uuid NOT NULL,
 document_id uuid NOT NULL,
 version_id uuid NOT NULL,
 name text NOT NULL,
 content_hash text NOT NULL,
 storage_key text NOT NULL,
 embedding_config text NOT NULL REFERENCES embedding_configs,
 created_by uuid NOT NULL,
 request_key uuid NOT NULL,
 retry_of uuid UNIQUE REFERENCES ingestion_jobs(id),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','ready','failed','cancelled')),
 phase text NOT NULL DEFAULT 'queued' CHECK(phase IN ('queued','reading','embedding','storage','indexing','finished')),
 cancel_requested boolean NOT NULL DEFAULT false,
 result jsonb,
 error text,
 lease_owner uuid,
 lease_until timestamptz,
 available_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,created_by,request_key),
 FOREIGN KEY(collection_id,project_id) REFERENCES collections(id,project_id),
 CHECK((status='ready') = (result IS NOT NULL))
);
CREATE UNIQUE INDEX ingestion_one_active_document ON ingestion_jobs(document_id)
 WHERE status IN ('queued','running');
CREATE INDEX ingestion_queue ON ingestion_jobs(available_at,created_at) WHERE status='queued';
CREATE INDEX ingestion_history ON ingestion_jobs(project_id,created_at DESC);
ALTER TABLE ingestion_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ingestion_jobs FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON ingestion_jobs FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON ingestion_jobs FROM authenticated;
 END IF;
END $$;

CREATE FUNCTION preserve_ingestion_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.project_id,NEW.collection_id,NEW.document_id,NEW.version_id,NEW.name,
        NEW.content_hash,NEW.storage_key,NEW.embedding_config,NEW.created_by,NEW.request_key,NEW.retry_of)
    IS DISTINCT FROM
    ROW(OLD.project_id,OLD.collection_id,OLD.document_id,OLD.version_id,OLD.name,
        OLD.content_hash,OLD.storage_key,OLD.embedding_config,OLD.created_by,OLD.request_key,OLD.retry_of)
    OR (OLD.status IN ('ready','failed','cancelled') AND
        ROW(NEW.status,NEW.phase,NEW.result,NEW.error) IS DISTINCT FROM ROW(OLD.status,OLD.phase,OLD.result,OLD.error)) THEN
  RAISE EXCEPTION 'Ingestion requests and final outcomes are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_ingestion BEFORE UPDATE ON ingestion_jobs
 FOR EACH ROW EXECUTE FUNCTION preserve_ingestion_request();
