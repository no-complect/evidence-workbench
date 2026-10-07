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
