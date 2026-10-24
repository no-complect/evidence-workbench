# Development and tests

The [Docker quick start](../README.md#running-the-application) is the recommended reviewer
path. It does not require host language tools. This guide is for changing code.

## Host setup

Install Python 3.12+, uv, and Node 24. `scripts/install-deps-macos.sh` can inspect
macOS prerequisites; installation is opt-in with `--install`.

```bash
uv sync --frozen
npm --prefix apps/web ci
cp .env.example .env
docker compose up -d db
uv run --frozen python -m workbench.seed
```

If `.env` already exists, retain your configuration rather than replacing it.
Run these in separate terminals from the repository root:

```bash
uv run --frozen uvicorn workbench.api:app --host 127.0.0.1 --port 8000 --reload
uv run --frozen python -m workbench.worker
uv run --frozen python -m workbench.evaluation_worker
APP_ENV=local npm --prefix apps/web run dev -- --hostname 127.0.0.1
```

Use `http://localhost:3000` for the UI and `http://localhost:8000/docs` for the
API schema. Do not also start the container API/web on those same ports.

## Unit, contract, and frontend checks

```bash
./scripts/test.sh
uv run --frozen ruff check services tests scripts
python3 scripts/check-offline.py
python3 scripts/check-publication.py
```

If your environment restricts the default uv cache, set
`UV_CACHE_DIR=.cache/uv`. An internet connection is required for initial installs.

The Pydantic-to-TypeScript generator is `scripts/check-contracts.py`; use its
`--write` flag after changing shared request/report models, then rerun the check.

## Real integration tests

Use a **dedicated disposable test database**. The suite seeds and changes data;
never point it at a production or research database. Start the local `db` service
and create the test database once:

```bash
docker compose exec -T db createdb -U workbench workbench_test
APP_ENV=test AUTH_MODE=demo LIVE_ENABLED=false \
DATABASE_URL=postgresql://workbench:workbench@localhost:55432/workbench_test \
STORAGE_PATH=.runtime/test-objects WORKBENCH_INTEGRATION=1 \
uv run --frozen pytest --timeout=180
```

The suite exercises actual SQL/vector retrieval, project/citation/storage
isolation, approval replay, version pinning, budget stops, cancellation,
parallel reservations, retries, process recovery, and the MCP client.

## Browser checks

Start the complete local demo, then:

```bash
cd apps/web
npx playwright install chromium
npm run test:e2e
```

Tests use the actual API and database on desktop and mobile. They create research
runs and upload synthetic files. Screenshots, traces, and HTML results stay in
ignored `test-results/` and `playwright-report/` directories. A maintainer may
review and copy a synthetic screenshot into `docs/examples/` for the README.

## Fresh container verification

With Docker Engine and Compose v2 available, run from the repository root:

```bash
python3 scripts/verify-compose.py
```

This builds the shipped images and starts an isolated Compose project with empty
volumes and random loopback ports. It ignores your `.env`, clears provider keys,
and uses only synthetic fixtures. Checks go through the Next standalone proxy:
starter collection setup/retry, pgvector ingestion, worker planning, approval
resumption after application container replacement, citations/source downloads,
and an authored evaluation across all three strategies using both workers.
The runner removes only its own containers and volumes, including on failure.
It does not modify the normal development stack or delete its data.

After installing frontend dependencies and Playwright Chromium, add `--browser`
to also run the existing desktop/mobile collection and research/evaluation journeys
against these containers. CI runs this as the separate **Fresh container journey**
job. Synthetic logs, service status and the successful result IDs are written to
`.runtime/compose-verification`; browser artifacts use the normal ignored folders.
This verifies the local demo topology; hosted Supabase identity/storage, public
TLS routing and paid-provider behavior require separate checks.

## Supabase identity and storage verification

CI's **Supabase identity and storage** job uses pinned Supabase CLI 2.120.0 and a
temporary local project, with real Auth, PostgREST and Storage services. After the
host dependencies and Playwright Chromium are installed, the same check is:

```bash
uv run --frozen python scripts/verify-supabase.py
```

The runner ignores hosted credentials, creates two synthetic local identities,
applies the actual migrations, builds Next with Supabase auth and runs the API and
research worker. Desktop/mobile browsers sign in using local generated magic links
without sending email, inspect private source data, sign out and switch accounts.
Checks cover owner reads, denied cross-user/anonymous API access, direct PostgREST
row policies and write denial, private bucket reads/writes, citation/source access,
and clearing project caches/drafts on account changes. Research uses explicit
scripted fixtures with paid integrations disabled. No hosted project is touched.

Auth browser traces, screenshots, state and HTML reports are disabled. Only safe
application logs and a success summary are retained in `.runtime/supabase-verification`.
Cleanup stops only the temporary Supabase project and its data. These local HTTP
checks do not verify production TLS, hosted resource settings or email delivery.
The app's account control signs out the current browser session; an already issued
access token can remain valid until expiry, as with normal Supabase JWT sessions.

## Dependency updates

Normal startup, builds, and CI use the committed locks. Only regenerate them for
an intentional dependency update:

```bash
./scripts/lock-deps.sh
uv sync --frozen
npm --prefix apps/web ci
./scripts/test.sh
```

Commit both manifests and any changed lockfiles together. The GitHub workflow
runs tests and the real browser journey without paid provider calls.
