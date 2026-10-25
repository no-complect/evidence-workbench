# Architecture and engineering boundaries

![Application architecture showing the browser, API, database, independent worker, research graph, retrieval, models, and checkpoints.](./diagrams/architecture.png)

[Scalable diagram](./diagrams/architecture.svg) · [Mermaid source](./diagrams/architecture.mmd)

## Data and authorization

Application migrations are ordered SQL files in `db/migrations`, recorded in `schema_migrations` under a migration advisory lock. LangGraph owns its checkpoint tables exclusively in `graph_checkpoints`; that schema is not exposed to Supabase clients. Use a direct or session-pooled Postgres connection, not transaction pooling, for checkpoint connections and session advisory locks.

`projects` and `project_memberships` define access. Collections select an immutable embedding configuration. Documents have a stable identity within a collection, and content hashes identify immutable versions. Chunks preserve section, page (PDF only), and character offsets within a page or text document. Long paragraphs are split at 1,600 characters; chunk boundaries and hashes are deterministic. A document points to its current version; reuploading old bytes can explicitly reactivate an existing immutable version. Runs pin the current version of each document **at submission**, so later ingestion cannot change their corpus. Existing citations retain old versions.

Collection setup stores a normalized purpose/source/profile intent and preparation
status. Its project/user/request-key identity reuses the same collection on retry.
A collection advisory lock serializes starter preparation; committed document
versions survive interruption. Ready retries return without reseeding user changes.
A database trigger prevents changing the setup intent or embedding profile.
Incomplete setup blocks uploads, retrieval and research until preparation resumes.

The browser owns local file intent in a project-scoped sequential upload queue.
Each row reports its actual response or validation/indexing error; it does not
simulate pipeline progress. Failed replacement ingestion leaves the previous
current version available. A document-scoped session advisory lock is acquired
before deduplication, parsing or embedding and held through status persistence.
Concurrent uploads of the same collection/filename receive a retryable 409 without
provider calls or source-status changes; different documents can proceed independently.
An explicit retry after completion reuses identical indexed bytes. This prevents
overlapping duplicate embedding work, not a repeat call after a crash between a
provider response and the database commit. The compatibility POST sources API remains
synchronous. Embedding costs remain outside the research ledger. Source counts and vector coverage describe that current
version, while version counts retain history. Retrieval experiments submit explicit
snapshots, use scoped abortable queries and disable automatic embedding-call retries
and refetches. Keyword retrieval makes no model call; Vector and Hybrid use the
collection's embedding profile. Component ranks and reciprocal-rank scores are
retrieval measurements, not calibrated confidence.

UI file transfers stage bounded bytes with a request key and return202. Durable
`ingestion_jobs` records pin content identity and collection profile; an independent
worker parses, embeds and indexes. Scoped abortable query caches own job records;
local file drafts are released after acceptance. Reloading restores saved progress,
with separate transfer, status-polling and retry/cancel errors. Job reads make no
provider calls. The API exposes only safe projections, never staging keys/leases.

The worker leases queued jobs and heartbeats ownership. Every stage and final
publication checks ownership; source versions and ready job outcomes commit in the
same transaction. Cancellation is cooperative and cannot retract an in-flight
charge. Recovery respects the document session guard and marks expired attempts
interrupted without automatic provider replay. Explicit retry creates one durable
child attempt, idempotently; prior results remain immutable. Queued jobs survive
restart. The worker requires private shared object storage; upload retention and
orphan cleanup are not provisioned. Ingestion embedding requests have the separate ledger described below.

`research_runs` is the durable queue and run projection. `research_tasks`, `evidence`, `claims`, and `citations` retain structured results. Composite foreign keys protect project/run relationships. `run_events` gives ordered cursors; `contexts` retains redacted assembled model inputs; `usage_records` records reservations and reconciled usage. `effects` stores replayable node results outside graph state. `evaluation_runs` stores measured demo aggregates; raw files contain per-case data. Large source bytes live in a local volume or a private Supabase bucket.

Production APIs verify both a shared backend secret and the user's Supabase access token through `/auth/v1/user`; every route verifies membership before retrieving source, run, context or citation data. Next.js passes the token without exposing worker/service-role credentials. Supabase JS reads authorized projects through RLS in the browser. The RLS migration exposes project-scoped reads only; client writes use the validating API. Workers have privileged database access but apply explicit project/collection predicates. A run references its submitter and collection. MCP tools call the same API and cannot mutate data.

The shipped local demo explicitly sets `APP_ENV=local`, `AUTH_MODE=demo`, and localhost host-port bindings. Production rejects demo authentication, missing Supabase Auth, local object storage, and default/short API secrets. This is not a hosted public-demo configuration. A public demo must use a dedicated deployment/database containing only synthetic sources and add quotas/rate limits before exposing it.

## Retrieval and embedding identity

`chunks.embedding` is a genuine pgvector column. Separate partial HNSW expression indexes support 16-dimensional fixture vectors and 1536-dimensional OpenAI vectors. Model identity, dimensions, and configuration version are stored in `embedding_configs`; chunk checks constrain dimensions, and queries filter project, collection, config and pinned source versions before ranking. Full-text retrieval uses an English `tsvector` GIN index and `websearch_to_tsquery`; vector retrieval uses cosine distance. Reciprocal-rank fusion uses `sum(1/(60+rank))`; top-k is bounded to 1–20. `DisabledReranker` is an explicit adapter, never reported as an applied reranker.

The LangChain integration is a small `BaseRetriever` wrapper returning `Document` objects, with the SQL repository as the authorization boundary. Demo queries select a versioned topic fixture; they do not claim arbitrary semantic embeddings. Unseeded demo uploads have NULL vectors and remain full-text searchable. Reindexing means choosing a new collection/configuration and ingesting again. No API mutates embedding identity in place. Web fetches create immutable source versions with URL/time metadata and bounded text chunks; they enter that run directly and are full-text searchable later, without an additional unbudgeted embedding call.

## Ingestion embedding accounting

`embedding_usage` records each ingestion embedding request before transmission,
independently of source-index and research-run transactions. Both durable UI jobs
and the compatibility upload API use the LangChain transport wrapper. Raw passages
are bounded to1,600 characters and batches to32, preserving the fixed1536-dimensional
profile without tokenizer downloads or hidden retries. Each boundary pins model,
input fingerprint/count/byte-based token bound, target source version and optional
USD-per-million rate; no source text, keys or provider error bodies enter this ledger.

Durable submissions/retries snapshot the optional embedding rate on the API. A
legacy synchronous attempt snapshots its process rate before embedding. Final
provider-reported usage is immutable and remains recorded if cancellation, lease
loss, denied access or indexing failure follows. Every durable batch reservation
checks current ownership, membership and cancellation; an existing reservation
cannot be replayed. A response without usage, a failed call or a crash before
reconciliation remains unreported. Late responses may reconcile their own reserved
row even after the job stops. Recording failure stops additional calls; it cannot
recover lost provider usage. This is accounting, not a dollar spending cap.

The membership-checked collection endpoint aggregates all recorded requests and
returns the latest20 safe request projections. RAG shows reported tokens separately
from unreported requests, optional estimates and input bounds. Costs are unavailable
if any request lacks usage or a price. No records does not certify past free usage:
older uploads may predate tracking. Fixture indexing/dedup makes no embedding call.
Retrieval/query embeddings and research/judge usage remain separate; this ledger
is not an account-wide billing total. Clearing upload rows does not clear usage.

## Environment model boundary

The API discovers all IDs from the fixed official OpenAI models endpoint using its
server `OPENAI_API_KEY`; authorization checks project membership before discovery.
No credential is sent to the browser or copied into new database connections.
The selector is available independently of the live-execution opt-in. Discovery
checks catalog access only, without paid probes or an inferred family allowlist.
Provider errors use safe generic messages and redirects/proxy inheritance are off.

The project-keyed UI owns selection intent; the project-scoped query cache owns
catalog data and consumes abort signals. Harness and Workflows share the same
selection. Each live run pins its chosen model for planner, reviewer and writer,
limits, prompt/contract/context/tool fingerprints and optional cost estimates in
its immutable snapshot. The worker reads the current environment key and checks
live enablement and fingerprints before calls. A default-model change cannot
switch a queued run. Failed model access/structured-output compatibility is visible
without a scripted fallback or prerequisite verification workflow.

Prices are optional. Estimates for the configured default are never reused for a
different selected model. Missing prices leave dollar totals unavailable; dollar
caps cannot cover unpriced calls. Token/tool/iteration/time limits and approval,
cancellation, lease and checkpoint controls remain in force. Embedding profiles
are a separate, immutable collection boundary.

Legacy local connection/revision endpoints and encrypted credentials remain for
existing records and queued snapshots. Production still rejects these legacy
management endpoints. They are absent from the current UI and not prerequisites
for environment-based discovery or research. Legacy snapshots retain their
credential revocation and fingerprint checks.

## Harness studio and inspectable execution

A project-owned configuration draft is shared by Harness and Workflows, separately
from scoped server query data. Typed request contracts carry additional system
instructions, bounded context policy and optional stage models. Live snapshots pin
the configuration plus its SHA-256; the worker combines run instructions with the
versioned stage prompt and records the effective prompt hash. Strict context policy
uses 70% of the balanced stage input cap; the same diversity, deduplication and
untrusted-source rules apply. Contracts remain fixed per stage. Schema previews and
sample validation use the actual Pydantic models, with validation locations/types
returned without echoing submitted values.

The execution graph is a projection of the actual LangGraph nodes. Its inspector
selects saved events and contexts by stage. Unexecuted nodes remain explicit
workflow definitions; it does not generate fictitious runtime traces. The decision
brief renders persisted claims and limitations, with citations opening pinned sources.

Collection evaluations freeze version IDs and labels at enqueue. The coordinator
passes those versions and a pinned live model snapshot to child runs. Source updates
cannot replace the evaluation corpus. Child runs retain per-run budgets/cancellation;
recovery reuses their idempotency keys. Collection retrieval metrics reuse retained
run evidence, avoiding additional unbudgeted embedding calls after completion.
Built-in fixtures retain their independent retrieval probe. Disclosure matching is
lexical, and no independent model-judge quality claim is made.

## Scheduling, checkpoints and replay

A worker leases eligible jobs using `FOR UPDATE SKIP LOCKED`, increments its attempt count and maintains a 30-second lease with heartbeats. An expired lease makes a job recoverable. A separate session advisory lock prevents an old executor and a replacement from actively executing the same run. Losing a lease stops further work; a replacement that cannot get the advisory lock backs off. Four attempts bound retries, with exponential backoff for timeout/network/429/5xx failures. Invalid inputs, authorization failures, unsupported model profiles and schema errors are not blindly retried.

Nodes use idempotent effect keys and deterministic evidence/claim IDs. Completed effects can be replayed after a checkpoint boundary without duplicate persisted records. This is **at-least-once**, not exactly-once external inference: a process can die after an external call and before its effect is saved. Usage reservations remain charged conservatively, and retries reserve again. Worker termination waits for a bounded active call when possible; a hard kill relies on lease recovery.

Approval uses a real LangGraph `interrupt` and `Command(resume=...)`. The plan and its approved version are saved separately from the original request, preserving submission idempotency. Time spent waiting for a human is excluded by giving approved execution a fresh wall-clock deadline; already consumed token/tool/cost budgets are retained. Cancellation is durable and cooperative. A running provider request may take up to its bounded timeout to return. Deadline checks stop new stages; in-flight calls and database/DNS operations can overrun the deadline. A strict process-level kill deadline is not implemented.

A row lock on the run serializes budget reservations from all parallel branches. Reservations include schema/message overhead, conservatively estimated input tokens, output caps, tool calls, and configured price estimates. Reported usage is reconciled; absent usage retains the reservation and is disclosed. A reported overrun stops further work. Exhaustion returns a marked partial report containing only already gathered excerpts. Failure/cancellation retains evidence for inspection. A budget cap is an estimate of cost, not a provider billing guarantee.

## Context and prompts

The versioned planner, reviewer, writer and optional judge prompts specify schemas, evidence rules, tool limits and stopping rules. The context assembler separates trusted instructions, user requirements, a typed summary and untrusted source passages. It avoids whole conversation histories, deduplicates text hashes, favors fresh sources, limits any one source to three passages, and logs selection/exclusion reasons. Headings, repeated fixture disclaimers, and flagged adversarial fixtures are excluded. Annotation-based exclusion demonstrates the boundary for a known test; it is not a universal prompt-injection detector.

The context UI projects the saved redacted input into separate instruction,
requirement, workflow-state and source-passage sections. A pure parser handles
legacy/malformed records without reconstructing them from raw evidence or the run
question. Context selection is local interaction state; saved records remain in
the existing project/user-scoped query cache. The same record components serve
Context, execution-node inspection and the embedded Harness view. Original-source
inspection uses only matching evidence already loaded for the selected run, with
no identifier-based fallback fetch. Redacted excerpts and original authorized
source text remain distinct. Selection/exclusion decisions, prompt hashes, token
bounds and raw saved input/trace metadata remain inspectable. These are persisted
assembled inputs, not a dump of provider SDK wire messages or private reasoning.

The no-dependency token estimator counts UTF-8 bytes as a conservative bound for supported text tokenizers, plus structured schema/message allowance. Stage context caps apply to assembled evidence; reservations also include the schema and output limit. Credential/email redaction is applied to persisted contexts/events. The source corpus itself remains accessible to authorized project users because it is the product's data. This redactor is intentionally limited and does not constitute DLP.

Model output cannot change access scopes, cost limits or available tools. Models return schema-validated plans/assessments/reports. The graph stores IDs, concise gaps/contradictions and plan state rather than unrestricted transcripts. UI decision summaries are observable results; private chain-of-thought is neither requested nor exposed.

## Web boundary

The live search adapter calls a fixed Tavily endpoint. Page fetches allow HTTP(S), public DNS destinations, ports 80/443, and no URL credentials. Every redirect is revalidated (at most three), mixed public/private DNS answers fail closed, and the selected public IP is pinned to the connection while HTTPS still verifies the original hostname. This prevents a second DNS lookup from redirecting the fetch to a private address. Fetches accept only text/plain or HTML, reject compressed payloads, cap bytes, set socket/overall read deadlines, strip script/style text, and retain fetch URL/time. Private collections never pass through the public web tool.

## Official references

Reviewed 2026-10-06, then mapped to the code paths in this repository:

- [Next.js App Router installation](https://nextjs.org/docs/app/getting-started/installation) and [Next.js 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16).
- [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence), [interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts), and [PostgresSaver implementation](https://github.com/langchain-ai/langgraph/blob/main/libs/checkpoint-postgres/langgraph/checkpoint/postgres/__init__.py).
- [OpenAI embedding response/usage](https://developers.openai.com/api/reference/resources/embeddings/methods/create).
- [LangChain ChatOpenAI](https://docs.langchain.com/oss/python/integrations/chat/openai).
- [Supabase vector columns](https://supabase.com/docs/guides/ai/vector-columns), [permission-aware RAG](https://supabase.com/docs/guides/ai/rag-with-permissions), and [auth client guidance](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs).
- [shadcn Next.js integration](https://ui.shadcn.com/docs/installation/next).
- [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search) and [MCP server development](https://modelcontextprotocol.io/docs/develop/build-server).

Documentation review is not a substitute for runtime verification. Dependency locks and the frontend build are available; see [BUILD_STATUS](BUILD_STATUS.md) for the current check scope and remaining integration/hosted verification.

## Durable semantic grading

Collection evaluations may opt into a separately targeted judge after research
cases finish. The submission snapshot freezes model, rubric, schema, sampling,
rates and separate judge limits. The worker's evaluation lease and advisory lock
fence execution. A transactional per-claim ledger serializes budget reservations;
the request boundary and final grades are immutable. An external call is reserved
before invocation and a response is saved before honoring cancellation. Recovery
reuses final results and marks ambiguous reservations ungraded instead of replaying
paid calls. Token/time bounds and explicit no-grade reasons survive recovery.

The judge receives only a redacted claim and its exact authorized cited passages.
Records retain input/claim/rubric/contract hashes and evidence/version identities.
A membership-checked read API exposes saved grades, including on cancelled jobs.
Browser queries remain project/job scoped and read-only. Model selection and
contract validation do not invoke inference. Deterministic evaluation checks,
fallible model grades and research-versus-judge accounting remain separate.
