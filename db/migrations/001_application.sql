SET LOCAL search_path = public, extensions;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_memberships (
  project_id uuid REFERENCES projects ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK(role IN ('owner','member')),
  PRIMARY KEY(project_id,user_id)
);

CREATE TABLE embedding_configs (
  id text PRIMARY KEY,
  model text NOT NULL,
  dimension integer NOT NULL,
  version text NOT NULL
);

INSERT INTO embedding_configs VALUES ('demo-v1','fixture-topic-vector',16,'1'),('openai-small-v1','text-embedding-3-small',1536,'1');

CREATE TABLE collections (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects,
  name text NOT NULL,
  embedding_config text NOT NULL REFERENCES embedding_configs,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,project_id)
);

CREATE TABLE source_documents (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  collection_id uuid NOT NULL,
  name text NOT NULL,
  status text NOT NULL,
  current_version_id uuid,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(collection_id,name),
  UNIQUE(id,project_id),
  FOREIGN KEY(collection_id,project_id) REFERENCES collections(id,project_id)
);

CREATE TABLE source_versions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  document_id uuid NOT NULL,
  content_hash text NOT NULL,
  storage_key text NOT NULL,
  media_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(document_id,content_hash),
  UNIQUE(id,document_id,project_id),
  UNIQUE(id,project_id),
  FOREIGN KEY(document_id,project_id) REFERENCES source_documents(id,project_id)
);

ALTER TABLE source_documents ADD CONSTRAINT documents_current_version_fk FOREIGN KEY(current_version_id,id,project_id) REFERENCES source_versions(id,document_id,project_id);

CREATE TABLE chunks (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  collection_id uuid NOT NULL,
  version_id uuid NOT NULL,
  ordinal int NOT NULL,
  text text NOT NULL,
  page int,
  section text,
  start_offset int NOT NULL,
  end_offset int NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  embedding_config text NOT NULL REFERENCES embedding_configs,
  embedding vector,
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english',text)) STORED,
  UNIQUE(version_id,ordinal),
  UNIQUE(id,project_id),
  FOREIGN KEY(version_id,project_id) REFERENCES source_versions(id,project_id),
  FOREIGN KEY(collection_id,project_id) REFERENCES collections(id,project_id),
  CHECK((embedding_config='demo-v1' AND vector_dims(embedding)=16) OR (embedding_config='openai-small-v1' AND vector_dims(embedding)=1536))
);

CREATE INDEX chunks_scope ON chunks(project_id,collection_id,embedding_config);

CREATE INDEX chunks_fts ON chunks USING gin(search_vector);

CREATE INDEX chunks_demo_vector ON chunks USING hnsw ((embedding::vector(16)) vector_cosine_ops) WHERE embedding_config='demo-v1';

CREATE INDEX chunks_live_vector ON chunks USING hnsw ((embedding::vector(1536)) vector_cosine_ops) WHERE embedding_config='openai-small-v1';

CREATE TABLE research_runs (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  collection_id uuid NOT NULL,
  user_id uuid NOT NULL,
  question text NOT NULL,
  mode text NOT NULL CHECK(mode IN ('demo','live')),
  strategy text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  request jsonb NOT NULL,
  corpus_versions jsonb NOT NULL,
  plan jsonb,
  approved_plan jsonb,
  report jsonb,
  error text,
  idempotency_key text NOT NULL,
  tokens_used int NOT NULL DEFAULT 0,
  tools_used int NOT NULL DEFAULT 0,
  cost_used numeric NOT NULL DEFAULT 0,
  cancel_requested boolean NOT NULL DEFAULT false,
  started_at timestamptz,
  deadline timestamptz,
  lease_owner text,
  lease_until timestamptz,
  attempts int NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id,user_id,idempotency_key),
  UNIQUE(id,project_id),
  FOREIGN KEY(collection_id,project_id) REFERENCES collections(id,project_id)
);

CREATE INDEX runs_queue ON research_runs(available_at,created_at) WHERE status IN ('queued','running','retrying');

CREATE TABLE research_tasks (
  id text NOT NULL,
  run_id uuid NOT NULL,
  project_id uuid NOT NULL,
  iteration int NOT NULL,
  question text NOT NULL,
  evidence_ids jsonb NOT NULL,
  PRIMARY KEY(run_id,id,iteration),
  FOREIGN KEY(run_id,project_id) REFERENCES research_runs(id,project_id)
);

CREATE TABLE evidence (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  project_id uuid NOT NULL,
  chunk_id uuid NOT NULL,
  scores jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id,chunk_id),
  UNIQUE(id,run_id,project_id),
  FOREIGN KEY(run_id,project_id) REFERENCES research_runs(id,project_id),
  FOREIGN KEY(chunk_id,project_id) REFERENCES chunks(id,project_id)
);

CREATE TABLE claims (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  project_id uuid NOT NULL,
  text text NOT NULL,
  support text NOT NULL,
  UNIQUE(id,run_id,project_id),
  FOREIGN KEY(run_id,project_id) REFERENCES research_runs(id,project_id)
);

CREATE TABLE citations (
  claim_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  run_id uuid NOT NULL,
  project_id uuid NOT NULL,
  PRIMARY KEY(claim_id,evidence_id),
  FOREIGN KEY(claim_id,run_id,project_id) REFERENCES claims(id,run_id,project_id),
  FOREIGN KEY(evidence_id,run_id,project_id) REFERENCES evidence(id,run_id,project_id)
);

CREATE TABLE run_events (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL,
  project_id uuid NOT NULL,
  event_key text NOT NULL,
  stage text NOT NULL,
  message text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id,event_key),
  FOREIGN KEY(run_id,project_id) REFERENCES research_runs(id,project_id)
);

CREATE TABLE usage_records (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  project_id uuid NOT NULL,
  call_key text NOT NULL,
  tokens int NOT NULL,
  tool_calls int NOT NULL,
  estimated_cost numeric NOT NULL,
  actual_tokens int,
  actual_cost numeric,
  status text NOT NULL DEFAULT 'reserved',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id,call_key),
  FOREIGN KEY(run_id,project_id) REFERENCES research_runs(id,project_id)
);

CREATE TABLE contexts (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  project_id uuid NOT NULL,
  call_key text NOT NULL,
  stage text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id,call_key),
  FOREIGN KEY(run_id,project_id) REFERENCES research_runs(id,project_id)
);

CREATE TABLE effects (
  run_id uuid NOT NULL,
  project_id uuid NOT NULL,
  effect_key text NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY(run_id,effect_key),
  FOREIGN KEY(run_id,project_id) REFERENCES research_runs(id,project_id)
);

CREATE TABLE evaluation_runs (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects,
  mode text NOT NULL,
  versions jsonb NOT NULL,
  results jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
