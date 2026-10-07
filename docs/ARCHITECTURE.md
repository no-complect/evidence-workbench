# Architecture and engineering boundaries

![Application architecture showing the browser, API, database, independent worker, research graph, retrieval, models, and checkpoints.](./diagrams/architecture.png)

[Scalable diagram](./diagrams/architecture.svg) · [Mermaid source](./diagrams/architecture.mmd)

## Data and authorization

Application migrations are ordered SQL files in `db/migrations`, recorded in `schema_migrations` under a migration advisory lock. LangGraph owns its checkpoint tables exclusively in `graph_checkpoints`; that schema is not exposed to Supabase clients. Use a direct or session-pooled Postgres connection, not transaction pooling, for checkpoint connections and session advisory locks.

`projects` and `project_memberships` define access. Collections select an immutable embedding configuration. Documents have a stable identity within a collection, and content hashes identify immutable versions. Chunks preserve section, page (PDF only), and character offsets within a page or text document. Long paragraphs are split at 1,600 characters; chunk boundaries and hashes are deterministic. A document points to its current version; reuploading old bytes can explicitly reactivate an existing immutable version. Runs pin the current version of each document **at submission**, so later ingestion cannot change their corpus. Existing citations retain old versions.

`research_runs` is the durable queue and run projection. `research_tasks`, `evidence`, `claims`, and `citations` retain structured results. Composite foreign keys protect project/run relationships. `run_events` gives ordered cursors; `contexts` retains redacted assembled model inputs; `usage_records` records reservations and reconciled usage. `effects` stores replayable node results outside graph state. `evaluation_runs` stores measured demo aggregates; raw files contain per-case data. Large source bytes live in a local volume or a private Supabase bucket.

Production APIs verify both a shared backend secret and the user's Supabase access token through `/auth/v1/user`; every route verifies membership before retrieving source, run, context or citation data. Next.js passes the token without exposing worker/service-role credentials. Supabase JS reads authorized projects through RLS in the browser. The RLS migration exposes project-scoped reads only; client writes use the validating API. Workers have privileged database access but apply explicit project/collection predicates. A run references its submitter and collection. MCP tools call the same API and cannot mutate data.

The shipped local demo explicitly sets `APP_ENV=local`, `AUTH_MODE=demo`, and localhost host-port bindings. Production rejects demo authentication, missing Supabase Auth, local object storage, and default/short API secrets. This is not a hosted public-demo configuration. A public demo must use a dedicated deployment/database containing only synthetic sources and add quotas/rate limits before exposing it.

## Retrieval and embedding identity

`chunks.embedding` is a genuine pgvector column. Separate partial HNSW expression indexes support 16-dimensional fixture vectors and 1536-dimensional OpenAI vectors. Model identity, dimensions, and configuration version are stored in `embedding_configs`; chunk checks constrain dimensions, and queries filter project, collection, config and pinned source versions before ranking. Full-text retrieval uses an English `tsvector` GIN index and `websearch_to_tsquery`; vector retrieval uses cosine distance. Reciprocal-rank fusion uses `sum(1/(60+rank))`; top-k is bounded to 1–20. `DisabledReranker` is an explicit adapter, never reported as an applied reranker.

The LangChain integration is a small `BaseRetriever` wrapper returning `Document` objects, with the SQL repository as the authorization boundary. Demo queries select a versioned topic fixture; they do not claim arbitrary semantic embeddings. Unseeded demo uploads have NULL vectors and remain full-text searchable. Reindexing means choosing a new collection/configuration and ingesting again. No API mutates embedding identity in place. Web fetches create immutable source versions with URL/time metadata and bounded text chunks; they enter that run directly and are full-text searchable later, without an additional unbudgeted embedding call.

## Scheduling, checkpoints and replay

A worker leases eligible jobs using `FOR UPDATE SKIP LOCKED`, increments its attempt count and maintains a 30-second lease with heartbeats. An expired lease makes a job recoverable. A separate session advisory lock prevents an old executor and a replacement from actively executing the same run. Losing a lease stops further work; a replacement that cannot get the advisory lock backs off. Four attempts bound retries, with exponential backoff for timeout/network/429/5xx failures. Invalid inputs, authorization failures, unsupported model profiles and schema errors are not blindly retried.

Nodes use idempotent effect keys and deterministic evidence/claim IDs. Completed effects can be replayed after a checkpoint boundary without duplicate persisted records. This is **at-least-once**, not exactly-once external inference: a process can die after an external call and before its effect is saved. Usage reservations remain charged conservatively, and retries reserve again. Worker termination waits for a bounded active call when possible; a hard kill relies on lease recovery.

Approval uses a real LangGraph `interrupt` and `Command(resume=...)`. The plan and its approved version are saved separately from the original request, preserving submission idempotency. Time spent waiting for a human is excluded by giving approved execution a fresh wall-clock deadline; already consumed token/tool/cost budgets are retained. Cancellation is durable and cooperative. A running provider request may take up to its bounded timeout to return. Deadline checks stop new stages; in-flight calls and database/DNS operations can overrun the deadline. A strict process-level kill deadline is not implemented.

A row lock on the run serializes budget reservations from all parallel branches. Reservations include schema/message overhead, conservatively estimated input tokens, output caps, tool calls, and configured price estimates. Reported usage is reconciled; absent usage retains the reservation and is disclosed. A reported overrun stops further work. Exhaustion returns a marked partial report containing only already gathered excerpts. Failure/cancellation retains evidence for inspection. A budget cap is an estimate of cost, not a provider billing guarantee.

## Context and prompts

The versioned planner, reviewer, writer and optional judge prompts specify schemas, evidence rules, tool limits and stopping rules. The context assembler separates trusted instructions, user requirements, a typed summary and untrusted source passages. It avoids whole conversation histories, deduplicates text hashes, favors fresh sources, limits any one source to three passages, and logs selection/exclusion reasons. Headings, repeated fixture disclaimers, and flagged adversarial fixtures are excluded. Annotation-based exclusion demonstrates the boundary for a known test; it is not a universal prompt-injection detector.

The no-dependency token estimator counts UTF-8 bytes as a conservative bound for supported text tokenizers, plus structured schema/message allowance. Stage context caps apply to assembled evidence; reservations also include the schema and output limit. Credential/email redaction is applied to persisted contexts/events. The source corpus itself remains accessible to authorized project users because it is the product's data. This redactor is intentionally limited and does not constitute DLP.

Model output cannot change access scopes, cost limits or available tools. Models return schema-validated plans/assessments/reports. The graph stores IDs, concise gaps/contradictions and plan state rather than unrestricted transcripts. UI decision summaries are observable results; private chain-of-thought is neither requested nor exposed.

## Web boundary

The live search adapter calls a fixed Tavily endpoint. Page fetches allow HTTP(S), public DNS destinations, ports 80/443, and no URL credentials. Every redirect is revalidated (at most three), mixed public/private DNS answers fail closed, and the selected public IP is pinned to the connection while HTTPS still verifies the original hostname. This prevents a second DNS lookup from redirecting the fetch to a private address. Fetches accept only text/plain or HTML, reject compressed payloads, cap bytes, set socket/overall read deadlines, strip script/style text, and retain fetch URL/time. Private collections never pass through the public web tool.

## Official references

Reviewed 2026-10-06, then mapped to the code paths in this repository:

- [Next.js App Router installation](https://nextjs.org/docs/app/getting-started/installation) and [Next.js 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16).
- [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence), [interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts), and [PostgresSaver implementation](https://github.com/langchain-ai/langgraph/blob/main/libs/checkpoint-postgres/langgraph/checkpoint/postgres/__init__.py).
- [LangChain ChatOpenAI](https://docs.langchain.com/oss/python/integrations/chat/openai).
- [Supabase vector columns](https://supabase.com/docs/guides/ai/vector-columns), [permission-aware RAG](https://supabase.com/docs/guides/ai/rag-with-permissions), and [auth client guidance](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs).
- [shadcn Next.js integration](https://ui.shadcn.com/docs/installation/next).
- [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search) and [MCP server development](https://modelcontextprotocol.io/docs/develop/build-server).

Documentation review is not a substitute for runtime verification. Dependency locks and the frontend build are available; see [BUILD_STATUS](BUILD_STATUS.md) for the current check scope and remaining integration/hosted verification.
