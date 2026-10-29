# Deployment and configuration

Use the [README](../README.md#running-the-application) for the local Docker demo.
The supplied Compose file binds to loopback and uses local-only credentials;
it is not a public deployment manifest. Hosted deployments need the services and
settings below. See [verification scope](DEVELOPMENT.md#verification-scope) for
what has been tested locally and what still requires hosted acceptance.

## Production Supabase

1. Configure a Supabase Postgres **direct or session-pooled TLS connection**.
   Transaction pooling is unsuitable for worker session locks/checkpoints.
2. Set the Python environment to `APP_ENV=production`, `AUTH_MODE=supabase` and
   `STORAGE_BACKEND=supabase`. Supply `DATABASE_URL`, a random 32+ character
   `API_SHARED_SECRET`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
   `SUPABASE_SERVICE_ROLE_KEY`. Accepted database TLS modes are `require`,
   `verify-ca` and `verify-full`; local/default database settings are rejected.
3. Apply migrations as the migration owner:

   ```bash
   uv run --frozen python -c 'from workbench.db import migrate; migrate()'
   ```

   Supabase migrations enable project-scoped reads and create the private
   `research-sources` bucket. A custom bucket needs equivalent private access rules.
4. Start the API and all three workers below. The research worker initializes its
   separate checkpoint schema. Demo seeding is disabled in production; sign in and
   create a project/collection through the UI. Adding other project members is
   currently an administrative SQL operation.
5. Before public access, verify sign-in/redirects, two-user source/citation/storage
   isolation, all workers, email and live execution on the deployed services.
   Configure quotas/rate limits, backups, retention and monitoring for your use case;
   the demo does not provision them.

Keep the service-role key on Python services. Source downloads pass through the
authorized API; browser users receive no unrestricted private-object URLs.

## Independently hosted API and workers

Build `services/research/Dockerfile` and run its image as four services:

| Service | Command |
| --- | --- |
| API | `uvicorn workbench.api:app --host 0.0.0.0 --port 8000` |
| Research | `python -m workbench.worker` |
| Ingestion | `python -m workbench.ingestion_worker` |
| Evaluation | `python -m workbench.evaluation_worker` |

Put the API behind HTTPS. Workers need always-on processes, the same database and
private storage configuration, and the relevant provider keys. They expose no
listeners. With Supabase Storage, workers need no persistent local source volume.
Configure restarts and a termination grace period longer than provider timeouts
(45 seconds in local Compose). Replicas coordinate through leases and session locks;
external calls may repeat after a crash.

`/health` checks API/database readiness. Monitor queue age, expired leases, failed
jobs and usage. Avoid raw provider exceptions, credentials and source bodies in logs.
Budget database connections across all replicas: `DB_POOL_MAX_SIZE` is per process,
and dedicated lock/checkpoint sessions are additional.

## Vercel web

Use `apps/web` as the Next.js project root and include files outside that root for
`packages/contracts`. Use Node 24, `npm ci` and `npm run build` with the committed lockfile.

Set `APP_ENV=production`, `API_URL=https://your-api.example`, the matching
`API_SHARED_SECRET`, `NEXT_PUBLIC_AUTH_MODE=supabase`, `NEXT_PUBLIC_SUPABASE_URL`
and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Public variables are embedded at build time.
Configure Supabase Auth's site URL and allowed redirects for the deployed web domain.

The Next.js proxy forwards user tokens and its server-only backend secret. Provider
keys belong on the Python API/workers, including ingestion for embeddings; adding
them only to the web project does not configure those services. Never expose
provider or service-role keys through `NEXT_PUBLIC_*`.

`API_URL` must be reachable from the web server; a deployed site cannot reach your
laptop's localhost. Long-running research, ingestion and evaluation execute in
workers after submission. File transfer/staging is still a bounded HTTP request;
check hosting upload limits for your deployment. The legacy synchronous source-upload
endpoint does not use the durable ingestion queue.

## Configuration validation and recovery

Python validates required settings at startup. An optional preflight checks their
shape/presence without service calls or printing values:

```bash
uv run --frozen python scripts/check-environment.py
```

Missing optional keys leave available demo features usable. Live research requires
`LIVE_ENABLED=true` and OpenAI embeddings, even with an Anthropic research model.
Model discovery makes no inference calls. Missing rates leave dollar estimates
unavailable; public-web research additionally needs Tavily and its configured rate.
See [Live models](../README.md#live-models) for the UI flow.

Correct setup errors, restart affected Python services, and rebuild/redeploy Next
for `NEXT_PUBLIC_*` changes. Temporary connection failures offer **Retry**; expired
sessions require sign-in. In host development, Next reads its process environment
or `apps/web/.env.local`, while Python reads the root `.env`.

Compose fixes local auth/database/storage/routing and reads only explicitly
interpolated overrides from `.env`, such as provider keys, rates, worker timing,
pool size and host ports. Startup preserves an existing `.env`. For local failures,
see [Troubleshooting](TROUBLESHOOTING.md).

## Read-only local or hosted check

Check an already running local stack:

```bash
uv run --frozen python scripts/verify-deployment.py
```

Defaults are `http://localhost:3000` and `http://localhost:8000`. For a hosted pair,
provide canonical HTTPS origins without credentials, paths or query strings:

```bash
uv run --frozen python scripts/verify-deployment.py \
  --web-url https://your-workbench.example \
  --api-url https://your-api.example
```

The runner makes GET requests to check application HTML, API/database readiness
and authentication/proxy routing. It rejects redirects and protection pages;
use a deployment accessible to the check. For an authenticated hosted bootstrap,
provide a short-lived `WORKBENCH_ACCESS_TOKEN` through the process environment and
add `--authenticated`. The runner does not read `.env`; never put tokens in URLs
or command-line arguments.

Results go to `.runtime/deployment-verification/result.json` or `--output PATH`.
Check the timestamp: an invocation rejected before network checks leaves an older
report intact. This smoke check neither starts services nor exercises worker jobs,
browser sign-in, email, two-user storage isolation or paid inference. Production
Supabase evaluations require authorized live execution; scripted UI benchmarks are
limited to local/test demo auth.

## Environment matrix

Local defaults are in [`.env.example`](../.env.example). All provider keys and
private storage credentials stay server-side.

| Setting | Purpose | Where |
| --- | --- | --- |
| `APP_ENV` | `local`, `test` or `production` | Next + Python |
| `AUTH_MODE` | `demo` locally; `supabase` in production | Python |
| `DATABASE_URL` | Postgres/pgvector; direct/session TLS URL in production | Python |
| `API_URL` | Reachable backend origin; HTTPS in production | Next server |
| `API_SHARED_SECRET` | Matching backend secret; random 32+ characters in production | Next + Python/MCP |
| `STORAGE_BACKEND` / `STORAGE_PATH` | `local` shared volume or `supabase` private Storage | Python |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Auth verification | Python |
| `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_STORAGE_BUCKET` | Private Storage; default bucket `research-sources` | Python |
| `NEXT_PUBLIC_AUTH_MODE` | `demo` or `supabase` | Browser build |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public Supabase auth configuration | Browser build |
| `LIVE_ENABLED` | Explicit opt-in to live execution | Python |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Configured provider catalogs and calls; OpenAI required for live embeddings | Python |
| `OPENAI_MODEL` / `ANTHROPIC_MODEL` | Initial model selection; Harness can select discovered IDs | Python |
| `OPENAI_EMBEDDING_MODEL` | Fixed live profile: `text-embedding-3-small`, 1536 dimensions | Python |
| `MODEL_INPUT_USD_PER_MILLION` / `MODEL_OUTPUT_USD_PER_MILLION` | Optional rates for the configured OpenAI default model | Python |
| `EMBEDDING_USD_PER_MILLION` | Optional ingestion embedding rate; separate from research budgets | Python |
| `TAVILY_API_KEY` / `WEB_SEARCH_USD_PER_CALL` | Optional public-web research | Python |
| `DB_POOL_MAX_SIZE` | Ordinary connections per API/worker process; default 10 | Python |
| `WORKBENCH_RESULTS_PATH` | Writable export directory; default `evals/results`, fixed `/app/evals/results` in Compose | Python process environment |
| `LEASE_SECONDS` / `POLL_SECONDS` | Worker lease/poll timing; defaults 30 / 0.5 | Python |
| `WORKBENCH_WEB_PORT` / `WORKBENCH_API_PORT` / `WORKBENCH_DB_PORT` | Local Compose host ports; defaults 3000 / 8000 / 55432 | Compose |

## Read-only MCP

Run `uv run --frozen python -m workbench.mcp_server` over stdio from an MCP client.
Set `WORKBENCH_API_URL`, `WORKBENCH_PROJECT_ID`, `API_SHARED_SECRET` and, in Supabase
mode, a current member `WORKBENCH_ACCESS_TOKEN`. Tools are `corpus_search`,
`evidence_lookup` and `run_status`. They use the same project-scoped API and cannot
start or mutate work.
