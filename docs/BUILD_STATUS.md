# Verification status — 2026-10-07

The repository includes application source, locked dependencies, a containerized
local demo, and a GitHub verification workflow. The public README describes the
implemented behavior and separates the scripted demo from live provider paths.
This record distinguishes checks run during repository preparation from older
runtime artifacts. It does not certify a production deployment.

## Checks run during public-repository preparation

Command: `UV_CACHE_DIR=.cache/uv UV_OFFLINE=1 ./scripts/test.sh`

- **28 unit/policy tests passed**, with 16 database integration tests deselected.
- **Pydantic/TypeScript contracts matched.**
- **Full TypeScript check passed.**
- **Next.js production build passed**, including page generation and build traces.
- `python3 scripts/check-offline.py` passed: Python/shell syntax, ten documents,
  41 passage/vector mappings, and fourteen evaluation cases.
- `ruff check services tests scripts` passed.
- Compose configuration validation passed.
- Publication preflight passed: 117 candidate files, approximately 0.80 MiB.
  Isolated checks confirmed tracked `.env` files and credential-like contents
  are rejected without printing secret values.
- A separate copy of the publishable source passed TypeScript and the Next
  production build without preexisting generated frontend files. This reused
  installed npm dependencies; it was not a fresh dependency download or Docker run.

These host checks used Python 3.14 and the installed dependencies from the
committed lockfiles. Containers and CI target Python 3.12 and Node 24. A build
emitted a Node dependency deprecation warning; the build completed successfully.

## Existing measured artifacts

An earlier container build/start log records the local stack reaching readiness.
The reviewed [fixture comparison](examples/fixture-comparison.md) and
[raw JSON](examples/fixture-comparison.json) record an actual synthetic evaluation
run with a code hash, source hashes, prompts, context policy, and per-case results.
These demonstrate prior execution but do not replace a fresh-checkout test of the
current source. Fixture responses/vectors do not measure live language-model
quality. Raw local logs and repeat evaluation exports are excluded from Git.

## Publication preparation

The README provides the Docker quick start, reviewer walkthrough, feature guide,
architecture overview, and links to deeper documentation. Ignore rules protect
local environment files, dependencies, runtime data, test artifacts, raw logs,
repeat evaluation outputs, and local authoring/configuration files. Runtime
assets, synthetic fixtures, generated contracts, and both locks remain included.

`python3 scripts/check-publication.py` checks the public candidate set, essential
assets, common secret patterns, local links, executable scripts, and file sizes.
CI also runs this preflight. See [RELEASING](RELEASING.md) for the final review.

## Local connection proxy fix

The local proxy previously validated `request.nextUrl.hostname`. Next.js can
construct that URL using the container's `0.0.0.0` bind address, so a browser
request to localhost could receive a 403 loopback-host error. The guard now
validates the browser-facing Host header and uses its origin for local POST
checks. Forwarded host headers are not trusted.

Nine route regression tests pass, covering localhost/IPv4/IPv6 connection and
submission requests, malformed/nonlocal hosts, cross-origin requests, and the
production branch. TypeScript and the production build pass after this fix.
The route tests use a stubbed backend response; they do not replace the real
Docker/browser acceptance checks below. Test command:
`npm --prefix apps/web run test:proxy`.

## Checks remaining before declaring the reviewer path verified

This preparation session cannot access the Docker daemon, and the local browser
endpoint was unavailable. Consequently the following were **not rerun here**:

- Fresh-checkout Compose startup with empty project volumes.
- `./scripts/demo.sh` and the complete reviewer walkthrough.
- The real pgvector integration/MCP/recovery suite.
- Desktop/mobile Playwright journeys and a reviewed report screenshot.

Run the sequence in [Development](DEVELOPMENT.md) and update this record with
measured outcomes. The GitHub workflow is configured to run real integration and
browser checks, but remote CI results should only be claimed after execution.

## Live and production boundaries

Hosted Supabase Auth/RLS/private Storage, paid OpenAI calls, public-web research,
and paid semantic judging require separate environment-specific verification.
No production-scale or hosted availability claim is made.

Known scope limits: scripted demo embeddings; disabled reranker; cooperative
cancellation/deadlines; synchronous live ingestion without its own cost ledger;
limited context redaction and annotation-based adversarial filtering; no OCR,
invitation UI, production rate limiting, or automated retention. See
[Architecture](ARCHITECTURE.md), [Evaluation](EVALUATION.md), and
[Deployment](DEPLOYMENT.md).
