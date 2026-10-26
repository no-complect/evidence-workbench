# Verification status

## Measured application evidence

At source `151e684` (merged in PR22 as `c7f71b0`, with identical files), both the
[push run](https://github.com/no-complect/evidence-workbench/actions/runs/40251661404)
and [pull-request run](https://github.com/no-complect/evidence-workbench/actions/runs/40251666336)
passed all three jobs:

| Boundary | Result |
| --- | --- |
| Python/API/domain | 257 tests, including real pgvector, authorization, budgets, ingestion accounting, workers, recovery and 20 judge-calibration checks |
| Standard desktop/mobile browser | 78 checks, including collection setup, research, evaluations, saved context, background preparation and usage-read recovery |
| Fresh Docker images and volumes | 22 browser checks plus queued upload recovery, persisted vectors, real proxy, approval recovery and the research, evaluation and ingestion workers |
| Real local Supabase | 2 browser checks with actual Auth/PostgREST/private Storage, two identities, denied cross-user access and same-browser account reset |
| Supporting checks | Types, production Next build, contracts, state/query and proxy tests, Ruff, formatting, publication boundaries and no-URL local routing |

These CI runs use synthetic model responses. Local Supabase runs with disposable
identities over HTTP; it does not verify hosted settings, public TLS or email.
Commands to reproduce the checks are in [Development](DEVELOPMENT.md).

The judge-calibration command validates its 18-case development set offline by
default. Synthetic SDK responses verify request blinding, budgets, failure handling
and coverage-aware scoring. These checks do not measure a live judge's agreement
with the reference labels. See [Evaluation](EVALUATION.md#judge-challenge-calibration).

The bundled [fixture comparison](examples/fixture-comparison.md) and
[raw JSON](examples/fixture-comparison.json) preserve an earlier measured synthetic
run with its own source manifest. They do not measure live model quality.

## Outstanding acceptance

- **Live quality:** synthetic CI does not establish live semantic accuracy,
  negative-claim rejection sensitivity or coverage across providers/models. Small
  bounded local samples are insufficient for a broad quality claim.
- **Hosted deployment:** two-user Auth/RLS/private Storage, browser redirects,
  email, public TLS/proxy routing and the deployed research, evaluation and ingestion
  workers remain unverified.
  The [read-only deployment check](DEPLOYMENT.md#read-only-hosted-deployment-check)
  covers routing/readiness only; its protocol tests are not hosted results.
- **Operational limits:** UI preparation runs in a background worker; staging and
  the compatibility source API remain synchronous. Ingestion has a separate embedding request ledger; costs are outside research-run caps and missing usage stays unknown. Unpriced calls cannot be dollar-bounded. Cancellation/deadlines are
  cooperative; context redaction and adversarial filtering are limited. No
  production-scale throughput or availability has been measured.

See [Architecture](ARCHITECTURE.md), [Evaluation](EVALUATION.md) and
[Deployment](DEPLOYMENT.md) for implemented boundaries. The application is not
declared production-ready on the strength of fixture CI.
