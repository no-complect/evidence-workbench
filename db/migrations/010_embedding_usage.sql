ALTER TABLE ingestion_jobs ADD COLUMN embedding_usd_per_million numeric
 CHECK(embedding_usd_per_million>=0 AND embedding_usd_per_million<'Infinity'::numeric);
ALTER TABLE ingestion_jobs ADD UNIQUE(id,project_id,collection_id);

CREATE OR REPLACE FUNCTION preserve_ingestion_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.project_id,NEW.collection_id,NEW.document_id,NEW.version_id,NEW.name,
        NEW.content_hash,NEW.storage_key,NEW.embedding_config,NEW.created_by,NEW.request_key,NEW.retry_of,NEW.embedding_usd_per_million)
    IS DISTINCT FROM
    ROW(OLD.project_id,OLD.collection_id,OLD.document_id,OLD.version_id,OLD.name,
        OLD.content_hash,OLD.storage_key,OLD.embedding_config,OLD.created_by,OLD.request_key,OLD.retry_of,OLD.embedding_usd_per_million)
    OR (OLD.status IN ('ready','failed','cancelled') AND
        ROW(NEW.status,NEW.phase,NEW.result,NEW.error) IS DISTINCT FROM ROW(OLD.status,OLD.phase,OLD.result,OLD.error)) THEN
  RAISE EXCEPTION 'Ingestion requests and final outcomes are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

CREATE TABLE embedding_usage (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL,
 collection_id uuid NOT NULL,
 source_version_id uuid NOT NULL,
 job_id uuid,
 attempt_id uuid NOT NULL,
 owner uuid NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal>=0),
 model text NOT NULL CHECK(model='text-embedding-3-small'),
 dimensions integer NOT NULL CHECK(dimensions=1536),
 input_hash text NOT NULL CHECK(length(input_hash)=64),
 input_count integer NOT NULL CHECK(input_count BETWEEN 1 AND 32),
 input_token_bound integer NOT NULL CHECK(input_token_bound BETWEEN 1 AND 204800),
 usd_per_million numeric CHECK(usd_per_million>=0 AND usd_per_million<'Infinity'::numeric),
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','reported','unreported')),
 reported_tokens bigint CHECK(reported_tokens>=0),
 provider_request_id text CHECK(length(provider_request_id)<=128),
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 UNIQUE(attempt_id,ordinal),
 FOREIGN KEY(collection_id,project_id) REFERENCES collections(id,project_id),
 FOREIGN KEY(job_id,project_id,collection_id) REFERENCES ingestion_jobs(id,project_id,collection_id),
 CHECK((status='reported') = (reported_tokens IS NOT NULL)),
 CHECK((status='reserved') = (finished_at IS NULL))
);
CREATE INDEX embedding_usage_scope ON embedding_usage(project_id,collection_id,created_at DESC);
ALTER TABLE embedding_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON embedding_usage FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON embedding_usage FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON embedding_usage FROM authenticated; END IF;
END $$;

CREATE FUNCTION preserve_embedding_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status<>'reserved'
    OR ROW(NEW.id,NEW.project_id,NEW.collection_id,NEW.source_version_id,NEW.job_id,
           NEW.attempt_id,NEW.owner,NEW.ordinal,NEW.model,NEW.dimensions,NEW.input_hash,
           NEW.input_count,NEW.input_token_bound,NEW.usd_per_million,NEW.created_at)
       IS DISTINCT FROM
       ROW(OLD.id,OLD.project_id,OLD.collection_id,OLD.source_version_id,OLD.job_id,
           OLD.attempt_id,OLD.owner,OLD.ordinal,OLD.model,OLD.dimensions,OLD.input_hash,
           OLD.input_count,OLD.input_token_bound,OLD.usd_per_million,OLD.created_at) THEN
  RAISE EXCEPTION 'Embedding request boundaries and final usage are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_embedding_usage BEFORE UPDATE ON embedding_usage
 FOR EACH ROW EXECUTE FUNCTION preserve_embedding_usage();
