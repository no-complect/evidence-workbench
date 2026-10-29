# Development and tests

To try the app, use the [Docker quick start](../README.md#running-the-application).
This guide is for changing the code. Run commands from the repository root unless
shown otherwise.

## Host setup

Install Python 3.12–3.14, uv, Node 24 and Docker with Compose v2.

```bash
uv sync --frozen
npm --prefix apps/web ci
test -f .env || cp .env.example .env
docker compose up -d db
uv run --frozen python -m workbench.seed
```

Review existing `.env` settings before using them for local development. Start each
process in a separate terminal:

```bash
uv run --frozen uvicorn workbench.api:app --host 127.0.0.1 --port 8000 --reload
uv run --frozen python -m workbench.worker
uv run --frozen python -m workbench.ingestion_worker
uv run --frozen python -m workbench.evaluation_worker
APP_ENV=local npm --prefix apps/web run dev -- --hostname 127.0.0.1
```

Open `http://localhost:3000`; the API schema is at `http://localhost:8000/docs`.
Avoid running the container API/web on the same ports. Python reads the root
`.env`; host Next.js reads its process environment or `apps/web/.env.local`.
See [configuration](DEPLOYMENT.md#configuration-validation-and-recovery) for live/auth settings.

## Unit, contract, and frontend checks

```bash
./scripts/test.sh
uv run --frozen ruff check services tests scripts
uv run --frozen ruff format --check services tests scripts
uv run --frozen python scripts/check-package.py
python3 scripts/check-offline.py
python3 scripts/check-publication.py
```

The test script runs Python lint/format and unit tests, generated-contract checks, frontend state
and proxy tests, lint, formatting, type checking and the production frontend build.
The package check exercises the wheel outside the checkout. The offline check
validates syntax and fixture integrity; the publication check checks the candidate
file set, required assets, links and common secret patterns.

After changing Pydantic request/response models, regenerate and check shared types:

```bash
uv run --frozen python scripts/check-contracts.py --write
uv run --frozen python scripts/check-contracts.py
```

Generated transport types live in `packages/contracts/models.ts`. See
[packages and contracts](ARCHITECTURE.md#packages-and-contracts) for runtime boundaries.

## Real integration tests

Use a **dedicated disposable database**: these tests seed and modify data. With
the local `db` service running, create the test database once, then run:

```bash
docker compose exec -T db createdb -U workbench workbench_test
APP_ENV=test AUTH_MODE=demo LIVE_ENABLED=false \
DATABASE_URL=postgresql://workbench:workbench@localhost:55432/workbench_test \
STORAGE_PATH=.runtime/test-objects WORKBENCH_INTEGRATION=1 \
uv run --frozen pytest --timeout=180
```

Coverage includes SQL/vector retrieval, authorization, source version pinning,
approval, budget reservations, cancellation, recovery and the MCP client.

## Browser checks

Start the complete local demo, then:

```bash
cd apps/web
npx playwright install chromium
npm run test:e2e
```

Desktop/mobile journeys create runs and upload synthetic files. They run serially
because they share seeded data and background workers; backend integration tests
cover concurrency separately. Browser artifacts stay in ignored `test-results/`
and `playwright-report/` directories.

## Fresh container verification

```bash
python3 scripts/verify-compose.py
```

Add `--browser` after installing frontend dependencies and Chromium to include the
browser suite.

The runner builds the shipped images, compares installed files with build inputs,
and exercises setup, retrieval, uploads, research, citations and evaluation through
the Next.js proxy. It recreates services to check worker recovery. It uses fresh
volumes, random loopback ports and synthetic fixtures, ignores local provider
credentials, and removes only its own containers/volumes. Results are written to
`.runtime/compose-verification`.

## Supabase identity and storage verification

With Supabase CLI 2.120.0 and the browser test dependencies installed:

```bash
uv run --frozen python scripts/verify-supabase.py
```

This creates a temporary local Supabase project and two identities. It checks
Auth, project RLS, private Storage, API/citation access and desktop/mobile account
switching. Hosted credentials are ignored; paid integrations are disabled. Cleanup
removes the temporary project. Safe logs/results stay in
`.runtime/supabase-verification`; auth browser artifacts are disabled to avoid
retaining callback tokens.

## Verification scope

The [CI workflow](../.github/workflows/ci.yml) runs the checks above. Consult
[CI runs](https://github.com/no-complect/evidence-workbench/actions/workflows/ci.yml)
for the tested revision and results.

Synthetic providers establish integration behavior, not live-model quality or judge
accuracy. Local Supabase tests do not establish hosted deployment readiness. Before
public use, verify real sign-in/redirects, two-user data/storage isolation, all
workers, TLS routing and email delivery on the deployed services. Production-scale
throughput and availability have not been measured. The
[read-only deployment check](DEPLOYMENT.md#read-only-local-or-hosted-check) covers
routing/authentication smoke checks only.

## Dependency updates

Startup and CI use committed lockfiles. For an intentional update:

```bash
./scripts/lock-deps.sh
uv sync --frozen
npm --prefix apps/web ci
./scripts/test.sh
```

Commit manifests and lockfiles together. Initial installs/builds need internet
access; use `UV_CACHE_DIR=.cache/uv` if your environment restricts the default cache.

## Before publishing changes

Follow [Contributing](CONTRIBUTING.md). Review the diff and publication check output;
ignore rules do not remove already tracked secrets or Git history. Keep credentials,
uploads, generated results and local execution artifacts untracked. Publication
checks are not an exhaustive secret scanner.
