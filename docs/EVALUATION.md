# Evaluating research

Open **Evaluations** to compare three strategies against the same cases:

| Strategy | Behavior |
| --- | --- |
| Basic RAG | One retrieval task and report, without follow-up |
| Fixed workflow | Planned subquestions, one research round and report |
| Bounded research | Follows gaps within iteration, tool, token and time limits |

A completed evaluation can still fail quality checks. Inspect individual failures
and use **Open case** to inspect the exact saved report, citations and context.

## Built-in scripted benchmark

Choose Development, Held-out or All cases, then **Run benchmark**. This is available
in local/test demo instances and makes no paid calls. Responses and vectors are
scripted: the benchmark tests retrieval and integration, not live-model quality
or a general advantage for iterative research.

Jobs pin code, prompt, corpus and case fingerprints. If those inputs change while
a job is queued, resubmit it; completed results remain readable. Run the benchmark
on the revision you want to measure rather than reusing historical exports.

For a local export from the running Compose stack:

```bash
bash scripts/eval.sh --split held-out
```

Omit `--split` for all cases. Exports stay ignored under `evals/results/`.

## Collection suites

Author one to six cases with a question and expected sources or an explicit
no-evidence expectation. An optional disclosure check matches text lexically.
Each case runs all three strategies, so six cases create eighteen investigations.
Submission freezes source versions, expectations, model/harness configuration and
per-run limits. Live suites require paid-call consent; editing the draft clears it.
Scripted suites use seeded questions and fixture-compatible collections.

Interpret the measures according to what they check:

- **Recall/MRR and source coverage:** retrieval against source relevance labels.
  Built-in benchmarks use an independent retrieval probe; collection suites use
  the top five retained passages ranked by RRF score and ID.
- **Citation validity:** evidence exists and is accessible to the investigation.
- **Quote support and disclosure:** literal/lexical matches, not semantic proof.
- **No-evidence cases:** whether the response abstains as expected.

No-claim and unmeasured results remain explicit. Fixture costs are zero because
no provider calls occur; missing live prices leave costs unavailable.

## Optional live grading

Select an independent **evaluation judge** in Harness, then enable grading in a
live collection suite. Research and judge stages can use different configured
OpenAI/Anthropic models. The judge receives sampled claims with their authorized
cited passages under the versioned `judge-v2` rubric. It labels material assertions
supported, contradicted or insufficient, with concise reasons and saved provenance.
Missing information is insufficient evidence, not an explicit contradiction.

Judge limits are separate from research limits. UI defaults are 6,000 suite tokens,
120 seconds, two claims per investigation and an estimated $0.25 cap when rates
are known. Unknown rates leave dollar estimates/enforcement unavailable; token,
sampling and time limits still apply. File-preparation embedding costs are separate.

The durable ledger reserves before inference and reuses saved grades after recovery.
Ambiguous calls remain ungraded instead of being automatically charged again.
Cancellation preserves saved results and prevents new calls. Missing usage retains
a conservative reservation. Unsampled, failed and budget-stopped claims stay visible.
Support ratios cover graded samples only: model grades are fallible and may be
correlated with the writer. They remain separate from deterministic checks.

## Judge challenge calibration

The [synthetic development set](../evals/judge-cases.json) has 18 author-annotated
claims, balanced across supported, contradicted and insufficient. It tests scope,
compound assertions, missing information and source instructions. These annotations
are reviewable assumptions, not independently established ground truth.

Validate the dataset offline without model calls:

```bash
uv run --frozen python -m workbench.calibrate_judge
```

An explicitly authorized live run requires server credentials, `LIVE_ENABLED=true`
and a model ID. This example permits at most six judge calls:

```bash
uv run --frozen python -m workbench.calibrate_judge \
  --live --allow-paid --model gpt-4.1 \
  --max-calls 6 --tokens 24000 --wall-seconds 120 --max-cost-usd 0.25
```

Use `--case ID` repeatedly to select cases; otherwise calls follow dataset order.
Prices apply only when configured for that model. Provider failures/invalid outputs
stop without retries. Reports retain reservations and fingerprints under
`evals/results/judge-calibration/`; starting another live command is a new,
potentially charged run. Rescore a saved report offline with:

```bash
uv run --frozen python -m workbench.calibrate_judge --predictions PATH_TO_REPORT.json
```

Read per-case errors, confusion matrix, label recall, grading coverage and **false
support rate**: unsupported reference claims labeled supported divided by graded
non-supported reference claims. Missing/failed/skipped outcomes are not correct
predictions. Small-subset accuracy is not full-suite accuracy.

The legacy `workbench.live_evaluate` command also remains available; inspect its
`--help` before using `--allow-paid`. It uses a separate OpenAI-judge orchestration
path and exports under `evals/results/live/`. Prefer UI suites for durable grading
and recovery; calibration/legacy CLI reports do not reproduce that ledger.

See [verification scope](DEVELOPMENT.md#verification-scope) for CI coverage. Audit
judge agreement on held-out real documents before relying on model grades.
