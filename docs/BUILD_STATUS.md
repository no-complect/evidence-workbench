# Verification status

## Measured application evidence

At source `adcaca6` (merged in PR12 as `94eaceb`, with identical source), both the
[push run](https://github.com/no-complect/evidence-workbench/actions/runs/40122037587)
and [pull-request run](https://github.com/no-complect/evidence-workbench/actions/runs/40122042095)
passed all three jobs:

| Boundary | Result |
| --- | --- |
| Python/API/domain | 158 tests, including real pgvector, authorization, budgets, workers and recovery |
| Standard desktop/mobile browser | 72 checks, including collection setup, research, evaluations, configuration recovery and saved-context inspection |
| Fresh Docker images and volumes | 16 browser checks plus ingestion, persisted vectors, real proxy, approval recovery after container recreation and both workers |
| Real local Supabase | 2 browser checks with actual Auth/PostgREST/private Storage, two identities, denied cross-user access and same-browser account reset |
| Supporting checks | Types, production Next build, contracts, 24 state/query tests, 11 proxy tests, Ruff, formatting and publication boundaries |

These CI runs use synthetic model responses. Local Supabase runs with disposable
identities over HTTP; it does not verify hosted settings, public TLS or email.
Commands to reproduce the checks are in [Development](DEVELOPMENT.md).

The bundled [fixture comparison](examples/fixture-comparison.md) and
[raw JSON](examples/fixture-comparison.json) preserve an earlier measured synthetic
run with its own source manifest. They do not measure live model quality.

## Outstanding acceptance

- **Live quality:** synthetic CI does not establish live semantic accuracy,
  negative-claim rejection sensitivity or coverage across providers/models. Small
  bounded local samples are insufficient for a broad quality claim.
- **Hosted deployment:** two-user Auth/RLS/private Storage, browser redirects,
  email, public TLS/proxy routing and both deployed workers remain unverified.
  The [read-only deployment check](DEPLOYMENT.md#read-only-hosted-deployment-check)
  covers routing/readiness only; its protocol tests are not hosted results.
- **Operational limits:** UI preparation runs in a background worker; staging and
  the compatibility source API remain synchronous. Embeddings are outside the run cost ledger. Unpriced calls cannot be dollar-bounded. Cancellation/deadlines are
  cooperative; context redaction and adversarial filtering are limited. No
  production-scale throughput or availability has been measured.

See [Architecture](ARCHITECTURE.md), [Evaluation](EVALUATION.md) and
[Deployment](DEPLOYMENT.md) for implemented boundaries. The application is not
declared production-ready on the strength of fixture CI.
