# Running and deploying

The local startup path is in the [README](../README.md#running-the-application). Dependency lockfiles are included. See [verification scope](DEVELOPMENT.md#verification-scope) before using this outside local development; hosted services and paid inference require separate checks.

## Local containers

`./scripts/dev.sh` checks Docker/Compose, creates a private `.env` from the secret-free example, builds the project containers, applies migrations, seeds idempotently, waits for health checks, prints URLs and follows logs. It binds only `127.0.0.1:3000`, `:8000` and `:55432` on the host. Container processes bind to their private interfaces so Compose networking works. The API and all three workers share the database and object volume; there is no extra object-storage microservice.

The local shared secret and database password are explicitly local-demo values. Do not expose this Compose stack publicly. Use `docker compose logs --follow api worker eval-worker ingestion-worker web` to reconnect to logs. Shutdown retains volumes; reset requires a separate destructive flag.

`python3 scripts/verify-compose.py` builds and tests a separate disposable stack,
using fresh volumes and random loopback ports without loading your environment
file or provider keys. Add `--browser` after installing the browser test dependencies
to exercise desktop/mobile journeys. See [Development](DEVELOPMENT.md#fresh-container-verification).
Normal startup retains ports 3000/8000/55432; `WORKBENCH_WEB_PORT`,
`WORKBENCH_API_PORT` and `WORKBENCH_DB_PORT` can override host ports.

For host Python/Node development and local integration tests, see
[Development](DEVELOPMENT.md#host-setup).

## Production Supabase

1. Use a Supabase project. Set a direct/session-pool `DATABASE_URL` with TLS (`sslmode=require`); transaction pooling is unsuitable for the worker's session locks.
2. On the API and all three workers, set `APP_ENV=production`, `AUTH_MODE=supabase`, a cryptographically random shared API secret (32+ characters), Supabase URL, anon/publishable key, and service-role key. Set `STORAGE_BACKEND=supabase`. Never put a service-role key in a `NEXT_PUBLIC_*` variable.
3. Apply migrations as the migration owner: `uv run python -c 'from workbench.db import migrate; migrate()'`. The runner detects the Supabase `auth` schema and applies `002_supabase_rls.sql`. It creates a private `research-sources` bucket. Browser writes remain behind API validation; reads require RLS membership.
4. The production worker initializes the separate checkpoint schema on startup. Demo seeding intentionally fails in production. Sign in and create a project/collection through the UI; project creation adds the authenticated owner membership. Invite/member management is currently an administrative SQL operation, not an implemented UI flow.
5. Verify two real user accounts, denied cross-project storage/citation access, private bucket behavior, and live requests before exposing the deployment. These hosted checks have not run here.

If you customize the storage bucket, create the equivalent private bucket yourself and keep service-role access server-side. Browser users do not receive unrestricted object URLs; downloads pass through the authorized API route.

The separate CI Supabase job exercises actual local Auth/PostgREST/private Storage
with two identities, API/citation authorization and same-browser sign-out/account
switching. See [Development](DEVELOPMENT.md#supabase-identity-and-storage-verification).
It uses `APP_ENV=test` for local HTTP, not production deployment configuration.
It does not replace the hosted two-user/TLS acceptance checks above.

## Independently hosted API and workers

Build `services/research/Dockerfile`. Run the image as four independently managed processes/services:

- API command: `uvicorn workbench.api:app --host 0.0.0.0 --port 8000` behind a TLS reverse proxy.
- Worker command: `python -m workbench.worker` with outbound provider access and the same database/storage config. It exposes no network listener.
- Ingestion worker command: `python -m workbench.ingestion_worker`, with shared private source storage and the same database/provider environment. It prepares staged UI uploads and exposes no listener. Expired jobs require explicit retry.
- Evaluation worker command: `python -m workbench.evaluation_worker`, with the same database/storage and provider environment. It coordinates research jobs and performs optional separately authorized claim grading; it exposes no network listener.

The workers need persistent Postgres and reachable Supabase Storage; they do not need a persistent local filesystem in production. They must run on an always-on container host (your existing VM/container platform is sufficient). Configure a restart policy and a termination grace period longer than the longest provider timeout (45 seconds in the local Compose). Multiple replicas coordinate using leases and session advisory locks. Provider requests can duplicate in a crash window; do not claim exactly-once inference. Retention, backups and production alerting are operator responsibilities and are not provisioned by this project.

Use `/health` for API readiness. Monitor queue age, expired leases, retries, failed jobs, and usage records. Do not log raw provider exceptions, secrets or entire source bodies. Scale only after measuring actual workload; there are no measured throughput/capacity claims in this repository.

## Vercel web

The frontend is a conventional Next.js App Router app. Configure Vercel's project root as `apps/web` and enable including source files outside the root directory (the generated contracts live in `packages/contracts`). Use Node 24, install with the committed lockfile using `npm ci`, and build with `npm run build`.

Set `APP_ENV=production`, `API_URL=https://your-deployed-api.example`, `API_SHARED_SECRET`, `NEXT_PUBLIC_AUTH_MODE=supabase`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Public variables are embedded at **build time**. Configure the Supabase Auth site's URL and allowed redirects to your actual Vercel domain. The browser uses Supabase JS auth; the Next API proxy forwards the user bearer token and a separate server-only backend secret. The browser may read its project list directly through Supabase RLS.

The model catalog, research and optional judge use `OPENAI_API_KEY` and/or
`ANTHROPIC_API_KEY` from the **Python API, research worker and evaluation worker
environment**. Local Docker supplies these from the root `.env`.
With the current separately hosted backend, adding these keys only to the Vercel
frontend does not configure the Python services; set them in those services’ deployment
environments too. If a future deployment hosts the Python API on Vercel, its
server-side environment uses the same variable. Never use a `NEXT_PUBLIC_` key.
No backend hosting topology is changed by the model selector.

See [Live models](../README.md#live-models) for model selection and the OpenAI
embedding dependency. [Evaluation](EVALUATION.md) explains grading and cost limits.

**A deployed Vercel app cannot reach your laptop's localhost API.** API_URL must be the publicly reachable, authenticated TLS API endpoint. Vercel requests submit jobs and return 202; they do not host the research loop. File transfer and staging are bounded synchronous requests; UI parsing/embedding/indexing run in the ingestion worker after a 202 response. The legacy POST sources API remains synchronous. Larger transfers may need direct-storage uploads.

Consult [Verification scope](DEVELOPMENT.md#verification-scope) for CI evidence and limits; hosted validation remains outstanding. No Vercel-native durable worker support is assumed or used. No deployment action is part of the local startup scripts.

## Configuration validation and recovery

The Python API validates required settings before accepting requests. The workers
and migration commands use the same settings loader. Local/test demo defaults
need no provider keys. Supabase authentication requires a valid `SUPABASE_URL` and
`SUPABASE_ANON_KEY`; Supabase Storage additionally requires its server-only
`SUPABASE_SERVICE_ROLE_KEY`. Production requires Supabase auth/storage, a random
32+ character shared secret and an explicit PostgreSQL `DATABASE_URL` with
`sslmode=require`, `verify-ca` or `verify-full`; the local database default is
rejected. Use direct/session pooling as described above. This validation checks
configuration shape and presence, not service connectivity or credential validity.

An optional local preflight reads the Python process environment/root `.env`:

```bash
uv run --frozen python scripts/check-environment.py
```

Required failures name the settings and exit nonzero without printing values.
Malformed typed values are also redacted. Missing optional provider keys leave the
demo usable; live research remains unavailable until its OpenAI embedding key and
explicit `LIVE_ENABLED` opt-in are present. An Anthropic key can still expose its
catalog independently. Missing model prices leave dollar estimates unavailable;
token/tool/time limits continue. Public web search requires `TAVILY_API_KEY` and
`WEB_SEARCH_USD_PER_CALL`; otherwise its UI option is unavailable and collection-only
research remains possible. A stale selected web option can be turned off.

The deployed Next proxy validates `APP_ENV`, the HTTPS API origin, the matching
shared secret and public Supabase settings before forwarding. Incomplete settings
produce a named setup message without an upstream request or repeated automatic
retries. A mismatched backend shared secret is reported as a setup error rather
than asking the user to sign in again. A web build without Supabase auth settings
also explains rebuilding when the API requires sign-in. Expired configured user
sessions still follow the sign-in flow. Browser auth configuration is checked before SDK initialization or sign-in;
missing settings display **Workspace setup is incomplete** with expandable setup
details. Temporary connection failures offer **Retry**. Optional live configuration
issues show a neutral notice while available workspace features stay usable.

Correct required settings, restart the affected API/workers, rebuild/redeploy for
`NEXT_PUBLIC_*` changes, then reload. For host Next development, provide its web
settings through the process environment or `apps/web/.env.local`; the root Python
`.env` is not automatically loaded by Next in that subdirectory. The provided
Compose file fixes local auth/database/storage and container API routing; only its
explicitly interpolated variables (keys, live opt-in, pricing, worker timing and
host-port overrides) are taken from root `.env`. Do not use that file as a production
deployment manifest. Startup never overwrites an existing `.env`.

## Read-only local or hosted check

Leave the web/API URL options omitted or empty to check the existing local Docker
stack at `http://localhost:3000` and `http://localhost:8000`:

```bash
uv run --frozen python scripts/verify-deployment.py
```

Blank settings stay blank; the runner resolves defaults for the check only. It
does not start containers or update environment files. Local checks verify web
HTML, API/database readiness, direct backend-key enforcement and demo identity
routing through the web proxy. Explicit loopback URLs support custom host ports.
Local results are labeled `local_docker`, separate from hosted acceptance.

For a hosted deployment, supply both URLs:

```bash
uv run --frozen python scripts/verify-deployment.py \
  --web-url https://your-workbench.example \
  --api-url https://your-api.example
```

Use the final canonical HTTPS origins. A mixed local/hosted pair is rejected.
Hosted checks verify the Workbench HTML,
API/database readiness, direct API key enforcement, the web proxy's configured
backend key, missing user sessions and invalid sessions. TLS verification stays
on, redirects are rejected, and response reads are bounded. A hosting protection
page or a generic 401 does not count as a successful application check. With
Vercel Deployment Protection, use an appropriately accessible deployment; do
not pass a token-bearing URL to this command.

For an additional authenticated bootstrap request, supply a short-lived user
access token through the process environment as `WORKBENCH_ACCESS_TOKEN` and
add `--authenticated` with hosted HTTPS origins. Local checks reject this option
before making requests. Never put the token in the command line, a committed file,
or the result report. The runner does not load `.env`, and ignores an inherited
token unless this flag is present. Expired sessions fail the check; no refresh
or sign-in is attempted. It needs no backend shared secret, service-role key,
database credentials or provider keys.

This command only makes GET requests. It creates no accounts, projects, sources,
runs or evaluations, and performs no model discovery or inference. Its summary
is `.runtime/deployment-verification/result.json` (or `--output PATH`), with the
check time, successful steps and explicit unverified boundaries. Failures exit
nonzero without printing raw responses or credentials. Inspect the timestamp;
an invocation rejected before network checks does not replace a prior report.

This is a routing/authentication smoke check, not complete hosted acceptance.
Browser sign-in/redirect settings, two-user RLS/private Storage, worker execution,
SMTP, paid quality and availability require separate measured checks. In particular,
scripted UI evaluations are currently enabled only for local/test demo auth;
production Supabase evaluations use live mode and require explicitly authorized
provider execution. A green read-only check does not prove that the research, evaluation or ingestion worker is running.

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
| CREDENTIAL_STORE_PATH | `.runtime/credentials` on host; `/data/credentials` in Compose | Private local credential key directory, shared by API and worker | Python only |
| OPENAI_API_KEY | Unused | Required for live model/embedding calls | Python only |
| OPENAI_MODEL | gpt-4.1-mini | Initial model selection; UI can choose any discovered ID | Python |
| ANTHROPIC_API_KEY | Unused | Optional Claude discovery/research/judge key | Python API + the research/evaluation workers only |
| ANTHROPIC_MODEL | Unused | Optional initial Claude ID when no OpenAI key is configured | Python |
| OPENAI_EMBEDDING_MODEL | Unused | text-embedding-3-small, dimension 1536 | Python |
| MODEL_INPUT_USD_PER_MILLION / MODEL_OUTPUT_USD_PER_MILLION | Unused | Optional estimate for OPENAI_MODEL only | Python |
| EMBEDDING_USD_PER_MILLION | Unused | Optional USD per million embedding tokens, pinned for each ingestion attempt; not a spending cap | Python |
| TAVILY_API_KEY / WEB_SEARCH_USD_PER_CALL | Unused | Required only when web research is enabled | Python |
| DB_POOL_MAX_SIZE | 10 per API/worker process | Tune across replicas and database connection limits; dedicated locks/checkpoints are additional | Python |
| WORKBENCH_RESULTS_PATH | /app/evals/results in Compose | Writable evaluation export directory; defaults to evals/results under the working directory | Python process environment |
| LEASE_SECONDS / POLL_SECONDS | 30 / 0.5 | Tune after testing | Worker |

## Read-only MCP

Run `uv run python -m workbench.mcp_server` over stdio from an MCP-compatible client. Configure `WORKBENCH_API_URL`, `WORKBENCH_PROJECT_ID`, `API_SHARED_SECRET`, and (production) `WORKBENCH_ACCESS_TOKEN`. The token is verified by the same API. Tools: `corpus_search`, `evidence_lookup`, `run_status`. There is no upload, write, cancellation or start-run tool. The real MCP client integration test starts an actual API subprocess and exercises tool listing, scoped search and rejected collection access. It requires the disposable test database described in [Development](DEVELOPMENT.md); consult [Verification scope](DEVELOPMENT.md#verification-scope) for CI evidence and limits.
