# Architecture

![The web proxy, API, three workers, Postgres, private storage and model boundary.](diagrams/architecture.png)

[Scalable diagram](diagrams/architecture.svg) · [Mermaid source](diagrams/architecture.mmd)

## Services and responsibilities

- **Next.js/React:** the workspace, Supabase sign-in and same-origin API proxy.
  The browser owns unsaved drafts; scoped query caches own server records.
- **FastAPI:** authentication, project membership checks, validated requests and
  durable job submission. Long-running work returns an acknowledgment for polling.
- **Research worker:** executes the LangGraph investigation, including approval,
  retrieval, model calls and citation verification.
- **Ingestion worker:** reads staged uploads, extracts passages, creates embeddings
  when configured, and publishes source versions.
- **Evaluation worker:** coordinates research cases and optional claim grading.
- **Postgres/pgvector:** memberships, source versions, retrieval indexes, queues,
  checkpoints, results and usage ledgers. Source bytes use a shared local volume
  or private Supabase Storage.

Workers run independently of browser requests. Postgres keeps coordination beside
provenance and authorization data. LangGraph supplies typed state, branches,
interrupts and checkpoints; LangChain supplies retrieval/model integrations.
Provider credentials remain on the Python services.

## Packages and contracts

`apps/web/src/app` contains Next.js routes and the backend proxy; `src/features`
contains workspace views, state and colocated styles; `src/components` contains
shared UI and providers. The Python package is `services/research/workbench`:
`api.py` assembles the app, while `*_api.py` modules group resource routers.
Pydantic request and response models generate
`packages/contracts/models.ts`; frontend-only query projections stay in the web app.
Known response fields are validated while existing extra fields and legacy saved
context remain readable.

The wheel bundles the authoritative `prompts/`, `db/migrations/`, `fixtures/` and
evaluation cases. Checkout and installed execution use the same logical
implementation fingerprints. Generated results go to writable `evals/results/`
or the process `WORKBENCH_RESULTS_PATH` override, outside package resources.
The Docker build installs the wheel in a separate build stage; verification
compares installed code/assets with the build inputs.

API and worker lifecycles own lazy database pools. `DB_POOL_MAX_SIZE` is a
per-process limit; dedicated lock/checkpoint sessions are additional. Long-lived
session locks retain dedicated connections so nested queries cannot exhaust their
own pool. API lifespan owns a reusable HTTP authentication client; identity and
bearer headers remain per request.

## Authorization and source provenance

The API verifies its backend secret and, in Supabase mode, the user's access token.
Routes check project membership before exposing sources, runs, contexts or
citations. Next.js forwards the user token with a separate server-only secret.
Supabase RLS permits project-scoped reads; browser writes go through the API.
Workers use explicit project/collection predicates. MCP tools use the same API.

Documents have stable identities and immutable content-hashed versions. Runs pin
the current source versions at submission, so later uploads cannot change their
citations. Chunks preserve page/section and character offsets. Failed replacements
leave the previous usable version available.

Collection setup is idempotent by project, user and request key. Its source intent
and embedding profile are immutable. Interrupted preparation can resume; incomplete
collections block uploads, retrieval and research until ready.

SQL migrations are ordered in `db/migrations` and recorded under a migration lock.
LangGraph checkpoint tables live in the separate `graph_checkpoints` schema,
which is not exposed to Supabase clients. Session locks/checkpoints require direct
or session-pooled Postgres connections, rather than transaction pooling.

## Retrieval and ingestion

Keyword search uses Postgres full-text search. Vector search uses pgvector cosine
distance and profile-specific HNSW indexes: 16-dimensional fixture vectors or
1536-dimensional OpenAI vectors. Queries restrict project, collection, embedding
profile and pinned versions before ranking. Hybrid search combines ranks through
reciprocal-rank fusion. Reranking is disabled.

Fixture vectors support known topics. New demo uploads remain keyword-searchable
without invented vectors. Live retrieval uses the collection's immutable embedding
profile. Retrieval experiments make explicit requests; they do not automatically
repeat embedding calls. Ranks and scores are retrieval measurements, not confidence.

UI uploads stage bounded bytes and return 202. The ingestion worker leases saved
jobs, checks ownership/cancellation and publishes the source version with the job
outcome in one transaction. A document session lock prevents concurrent preparation
of the same filename. Reloading restores saved progress. Expired interrupted
attempts require explicit retry; completed identical bytes reuse a version.

`embedding_usage` reserves each file-preparation request before transmission and
records provider-reported usage independently of indexing success. Missing usage
remains unreported, and unknown prices leave cost unavailable. Cancellation cannot
retract an in-flight charge. This ledger is separate from research/judge budgets
and is not an account-wide billing total. Retention/orphan cleanup is not provisioned.

## Research, approval and recovery

Research follows **plan → approval → gather → assess → follow up or write → verify
citations → finalize**. Basic RAG retrieves once; Fixed workflow investigates
planned subquestions once; Bounded research follows gaps within its limits.

Workers lease jobs using `FOR UPDATE SKIP LOCKED`, heartbeat ownership and recover
expired leases. Session advisory locks prevent two executors from actively owning
the same run. Saved effects and deterministic identities avoid duplicate persisted
results after checkpoint replay. External inference is at-least-once: a crash after
a provider call but before saving its result can cause another charged call.

Approval uses a LangGraph interrupt and resumes the saved thread. Waiting for
approval does not consume execution time; consumed token/tool/cost budgets remain.
Parallel branches reserve budgets under a run lock. Missing usage retains a
conservative reservation. Budget exhaustion produces a marked partial result from
already gathered evidence; cancellation and failure preserve evidence for inspection.
Cancellation/deadlines are cooperative, so in-flight operations can outlast them.

## Models and saved context

Harness discovers configured OpenAI/Anthropic model catalogs without inference.
Catalog membership does not establish execution permission or structured-output
compatibility. Live runs pin model/provider adapters, prompts, contracts, context
policy, limits and optional rates. Workers check these fingerprints before calls;
configuration changes cannot silently replace queued work. Legacy connection
snapshots retain their existing revocation checks; new UI runs use environment keys.

The context assembler separates trusted instructions, user requirements, workflow
state and untrusted passages. It deduplicates passages, bounds source/context size
and records selection/exclusion reasons. The UI reads saved redacted inputs, even
for older records; it does not reconstruct missing context from current sources.
Models cannot change authorization, available tools or execution limits. Private
chain-of-thought is neither requested nor displayed. Redaction and known adversarial
fixture filtering are limited, not comprehensive DLP or prompt-injection protection.

Public-web research uses a fixed Tavily endpoint. Fetches validate public HTTP(S)
destinations and every redirect, pin the resolved address, verify TLS, bound bytes
and time, and accept text/HTML only. Private collection bytes are not sent to the
public-web tool.

## Evaluation boundaries

Collection suites pin source versions, case expectations, configuration and limits.
Child investigations use stable request keys for recovery. Optional judges receive
only a redacted claim and its authorized cited passages under a pinned rubric.
Separate judge reservations bound sampling and usage; saved grades are reused,
while ambiguous paid calls remain explicitly ungraded instead of being replayed.
Deterministic checks and fallible model grades remain separate.

See [Evaluation](EVALUATION.md) for result interpretation,
[Development](DEVELOPMENT.md#verification-scope) for verification scope, and
[Deployment](DEPLOYMENT.md) for hosted requirements.
