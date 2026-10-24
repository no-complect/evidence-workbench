# Verification status

## Most recent completed application verification

At source `7e0b43d` (merged in PR10 as `74c9a88`), both the
[push run](https://github.com/no-complect/evidence-workbench/actions/runs/40053954947)
and [pull-request run](https://github.com/no-complect/evidence-workbench/actions/runs/40053958758)
passed all three jobs on 2026-10-23:

| Boundary | Measured result |
| --- | --- |
| Python/API/domain | 114 tests, including pgvector, worker, MCP, authorization, budgets and recovery |
| Standard desktop/mobile browser | 62 checks, including collection setup/return, explicit research, evaluation and tooltip journeys |
| Fresh Docker images and volumes | 16 desktop/mobile checks plus real proxy, ingestion, persisted vectors, approval recovery after container recreation and both worker processes |
| Real local Supabase | 2 desktop/mobile checks with actual Auth/PostgREST/private Storage, two identities, denied row/object access, source/citation authorization and same-browser sign-out/account reset |
| Supporting checks | Types, production Next build, contracts, 19 state/query tests, 9 proxy tests, Ruff, formatting and publication boundaries |

These are remote CI results. The preparation environment has no Docker daemon.
Supabase uses disposable local services with HTTP and synthetic accounts; it is
not a test of hosted Supabase configuration, public TLS or email delivery. No
paid providers were used. See [Development](DEVELOPMENT.md) for the reusable
container and Supabase verification commands.

New-project research now guides collection preparation and returns to the same
question/settings without automatically starting a run. Existing empty or
interrupted collections route to source setup. Loading/error states do not
masquerade as empty data; RAG's empty selector is disabled and its action is
**Add Collection**.

## Hosted deployment verification

A read-only [HTTPS deployment checker](DEPLOYMENT.md#read-only-hosted-deployment-check)
is available for an already deployed web/API pair. It verifies application HTML,
API/database readiness, backend-key enforcement and proxy/session routing, with
an optional explicitly supplied user session. Its synthetic protocol tests do
not count as a hosted result. No hosted deployment has been checked here.

The checker writes a timestamped summary with explicit unverified boundaries;
it makes no mutations or paid calls. It does not prove browser sign-in settings,
RLS/private Storage isolation or either worker's execution. Production Supabase
evaluations use live mode and require separate explicit paid-provider authorization.

## Earlier measured evidence

The reviewed [fixture comparison](examples/fixture-comparison.md) and
[raw JSON](examples/fixture-comparison.json) retain an earlier actual synthetic
evaluation with code/source hashes, prompts, context policy and per-case results.
Fixture responses and vectors do not measure live language-model quality.
Earlier preparation and container results are preserved in Git history; they do
not supersede the exact-source CI results above.

## Live and production boundaries

Hosted Supabase Auth/RLS/private Storage, browser redirects, SMTP delivery, public
TLS routing, deployed worker execution, paid-provider quality and production
availability remain environment-specific checks. No production-scale or hosted
availability claim is made. The local proxy's Host/origin and production branch
regressions have unit coverage; full container journeys exercise the real proxy.

Known scope limits: scripted demo embeddings; disabled reranker; cooperative
cancellation/deadlines; synchronous live ingestion without its own cost ledger;
limited context redaction and annotation-based adversarial filtering; no OCR,
invitation UI, production rate limiting, or automated retention. See
[Architecture](ARCHITECTURE.md), [Evaluation](EVALUATION.md), and
[Deployment](DEPLOYMENT.md).

## Publication boundary

Ignore rules protect environment files, authoring/context documents, dependencies,
runtime data, test artifacts, raw logs and repeat evaluation outputs. Runtime
assets, synthetic fixtures, generated contracts and dependency locks are included.
`python3 scripts/check-publication.py` checks the public candidate set, required
assets, local links, executable scripts, file sizes and common credential patterns.
See [Releasing](RELEASING.md) for review and fresh-checkout instructions.
