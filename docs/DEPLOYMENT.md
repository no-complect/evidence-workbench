# Running and deploying

The local reviewer path is in the [README](../README.md#running-the-application). Dependency lockfiles are included. See [verification status](BUILD_STATUS.md) before using this outside local development; hosted services and paid inference require separate checks.

## Local containers

`./scripts/dev.sh` checks Docker/Compose, creates a private `.env` from the secret-free example, builds the project containers, applies migrations, seeds idempotently, waits for health checks, prints URLs and follows logs. It binds only `127.0.0.1:3000`, `:8000` and `:55432` on the host. Container processes bind to their private interfaces so Compose networking works. The API and worker share the database and object volume; there is no extra object-storage microservice.

The local shared secret and database password are explicitly local-demo values. Do not expose this Compose stack publicly. Use `docker compose logs --follow worker api web` to reconnect to logs. Shutdown retains volumes; reset requires a separate destructive flag.

## Local host development

Run `uv sync --frozen` and `npm --prefix apps/web ci`. Start pgvector with `docker compose up -d db`, configure `.env` from `.env.example`, then use separate terminals:

```bash
uv run python -m workbench.seed
uv run uvicorn workbench.api:app --host 127.0.0.1 --port 8000 --reload
uv run python -m workbench.worker
```

In another terminal: `APP_ENV=local npm --prefix apps/web run dev`. The Next development command binds all local interfaces; use `npm --prefix apps/web run dev -- --hostname 127.0.0.1` if running directly on a shared network. Compose host bindings remain loopback-only. The web process uses the local default proxy secret only when `APP_ENV=local/test` is explicit. Host tests can point to another database; use a dedicated `workbench_test` database and `WORKBENCH_INTEGRATION=1`.

## Production Supabase

1. Create a Supabase project only after explicitly authorizing the resources and costs. Set a direct/session-pool `DATABASE_URL` with TLS (`sslmode=require`); transaction pooling is unsuitable for the worker's session locks.
2. On the API/worker, set `APP_ENV=production`, `AUTH_MODE=supabase`, a cryptographically random shared API secret (32+ characters), Supabase URL, anon/publishable key, and service-role key. Set `STORAGE_BACKEND=supabase`. Never put a service-role key in a `NEXT_PUBLIC_*` variable.
3. Apply migrations as the migration owner: `uv run python -c 'from workbench.db import migrate; migrate()'`. The runner detects the Supabase `auth` schema and applies `002_supabase_rls.sql`. It creates a private `research-sources` bucket. Browser writes remain behind API validation; reads require RLS membership.
4. The production worker initializes the separate checkpoint schema on startup. Demo seeding intentionally fails in production. Sign in and create a project/collection through the UI; project creation adds the authenticated owner membership. Invite/member management is currently an administrative SQL operation, not an implemented UI flow.
5. Verify two real user accounts, denied cross-project storage/citation access, private bucket behavior, and live requests before exposing the deployment. These hosted checks have not run here.

If you customize the storage bucket, create the equivalent private bucket yourself and keep service-role access server-side. Browser users do not receive unrestricted object URLs; downloads pass through the authorized API route.

## Independently hosted API and worker

Build `services/research/Dockerfile`. Run the image as two independently managed processes/services:

- API command: `uvicorn workbench.api:app --host 0.0.0.0 --port 8000` behind a TLS reverse proxy.
- Worker command: `python -m workbench.worker` with outbound provider access and the same database/storage config. It exposes no network listener.

The worker needs persistent Postgres and reachable Supabase Storage; it does not need a persistent local filesystem in production. It must run on an always-on container host (your existing VM/container platform is sufficient). Configure a restart policy and a termination grace period longer than the longest provider timeout (45 seconds in the local Compose). Multiple replicas coordinate using leases and session advisory locks. Provider requests can duplicate in a crash window; do not claim exactly-once inference. Retention, backups and production alerting are operator responsibilities and are not provisioned by this project.

Use `/health` for API readiness. Monitor queue age, expired leases, retries, failed jobs, and usage records. Do not log raw provider exceptions, secrets or entire source bodies. Scale only after measuring actual workload; there are no measured throughput/capacity claims in this repository.

## Vercel web

The frontend is a conventional Next.js App Router app. Configure Vercel's project root as `apps/web` and enable including source files outside the root directory (the generated contracts live in `packages/contracts`). Use Node 24, install with the committed lockfile using `npm ci`, and build with `npm run build`.

Set `APP_ENV=production`, `API_URL=https://your-deployed-api.example`, `API_SHARED_SECRET`, `NEXT_PUBLIC_AUTH_MODE=supabase`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Public variables are embedded at **build time**. Configure the Supabase Auth site's URL and allowed redirects to your actual Vercel domain. The browser uses Supabase JS auth; the Next API proxy forwards the user bearer token and a separate server-only backend secret. The browser may read its project list directly through Supabase RLS.

**A deployed Vercel app cannot reach your laptop's localhost API.** API_URL must be the publicly reachable, authenticated TLS API endpoint. Vercel requests submit jobs and return 202; they do not host the research loop. Source uploads are bounded synchronous requests and may need a direct-storage upload design for larger future ingestion workloads.

The local Next production build passes; a hosted deployment has not been verified. No Vercel-native durable worker support is assumed or used. No deployment action is part of the local startup scripts.

## Environment matrix

| Variable | Local demo | Production/live | Exposure |
|---|---|---|---|
| APP_ENV | local (test for CI) | production | Server |
| AUTH_MODE | demo | supabase | Python server |
| DATABASE_URL | Local pgvector database | Supabase direct/session TLS URL | API/worker only |
| API_URL | http://api:8000 in Compose | Reachable HTTPS API | Next server |
| API_SHARED_SECRET | Explicit local-only value | Random 32+ character secret | Next + API/MCP |
| STORAGE_BACKEND | local | supabase | Python |
| STORAGE_PATH | Shared /data/objects volume | Unused | Python |
| SUPABASE_URL / SUPABASE_ANON_KEY | Unused | Required for auth verification | Python |
| SUPABASE_SERVICE_ROLE_KEY | Unused | Required for private storage | Python only |
| SUPABASE_STORAGE_BUCKET | research-sources | Private bucket | Python |
| NEXT_PUBLIC_AUTH_MODE | demo | supabase | Browser build |
| NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY | Unused | Required | Browser build; public values only |
| LIVE_ENABLED | false | true only when explicitly opting in | Python |
| OPENAI_API_KEY | Unused | Required for live model/embedding calls | Python only |
| OPENAI_MODEL | gpt-4.1-mini | Supported GPT-4.1 profile | Python |
| OPENAI_EMBEDDING_MODEL | Unused | text-embedding-3-small, dimension 1536 | Python |
| MODEL_INPUT_USD_PER_MILLION / MODEL_OUTPUT_USD_PER_MILLION | Unused | Operator's estimate, required for live | Python |
| EMBEDDING_USD_PER_MILLION | Unused | Required for live run budgets | Python |
| TAVILY_API_KEY / WEB_SEARCH_USD_PER_CALL | Unused | Required only when web research is enabled | Python |
| LEASE_SECONDS / POLL_SECONDS | 30 / 0.5 | Tune after testing | Worker |

## Read-only MCP

Run `uv run python -m workbench.mcp_server` over stdio from an MCP-compatible client. Configure `WORKBENCH_API_URL`, `WORKBENCH_PROJECT_ID`, `API_SHARED_SECRET`, and (production) `WORKBENCH_ACCESS_TOKEN`. The token is verified by the same API. Tools: `corpus_search`, `evidence_lookup`, `run_status`. There is no upload, write, cancellation or start-run tool. The real MCP client integration test starts an actual API subprocess and exercises tool listing, scoped search and rejected collection access. It requires the disposable test database described in [Development](DEVELOPMENT.md); consult [BUILD_STATUS](BUILD_STATUS.md) for the verification record.
