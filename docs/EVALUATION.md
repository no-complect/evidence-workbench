# Evaluating research

Open **Evaluations** to queue a comparison. The separate evaluation worker
coordinates research runs across three strategies:

| Strategy | Behavior |
| --- | --- |
| Basic RAG | One retrieval task and report, without follow-up |
| Fixed workflow | Planned subquestions, one research round and report |
| Bounded research | Follows identified gaps within iteration, tool, token and time limits |

Progress, cancellation, case results and version manifests remain inspectable.
Execution completion is distinct from passing quality checks. **Open case** opens
the exact saved investigation for report, citation and context inspection.

## Built-in scripted benchmark

Choose Development, Held-out or All cases, then **Run benchmark**. This benchmark
is restricted to local/test demo instances and makes no paid calls. The job pins
code, corpus and case hashes; changed benchmark inputs are rejected. Dedicated
collections and stable per-case keys let the coordinator recover completed work.

These small hand-authored fixtures test integration and retrieval behavior. Their
responses and vectors are scripted; they do not establish live-model quality or
a general advantage for iterative research. The bundled [comparison](examples/fixture-comparison.md)
and [JSON](examples/fixture-comparison.json) are historical measurements with their
own version manifest. New exports remain ignored under `evals/results/`.

## Collection suites

Author one to six cases against an existing collection. Each case states a question
and expected source or explicit no-evidence expectation, with an optional lexical
disclosure check. Three strategies run each case, so six cases create eighteen
investigations. Submission freezes source versions, expectations, models, harness
configuration and per-run limits. Live suites require explicit paid-call consent;
changing the draft clears it. Scripted cases accept only seeded questions and the
fixture embedding profile.

Inspect individual failures alongside aggregates. Retrieval metrics use human
source relevance labels; fixture benchmarks use an independent retrieval probe,
while collection suites use the top five retained passages by RRF score and ID.
Recall/MRR and source coverage are retrieval measures, not semantic correctness.
Citation checks verify existence/access; literal quote and disclosure checks are
lexical. No-evidence expectations check abstention. No-claim or unmeasured results
stay explicit rather than becoming perfect scores. Fixture costs are zero because
there are no live provider calls; live missing-price costs stay unavailable.

## Optional live grading

Select an independent **evaluation judge** in Harness, then enable grading in a
live collection suite. Research stages and judge may use different configured
OpenAI or Anthropic models. The worker samples cited claims and sends each with
its authorized passages under the versioned `judge-v1` rubric. Saved results
include supported/contradicted/insufficient judgments, concise reasons, model and
contract hashes, source identities and usage. Raw provider responses and private
chain-of-thought are not retained.

Grading has separate suite-wide limits: by default 24,000 tokens, 120 seconds and
a $1 estimated-cost cap at pinned rates, plus the configured claim sample. Unknown
rates disable dollar estimates/enforcement; token/sample/time limits still apply.
Research limits and costs are separate. Ingestion embedding costs precede the
suite and are outside its budget.

The durable claim ledger reserves before inference and reuses final grades after
recovery. An ambiguous reserved call is explicitly ungraded and is not retried
automatically. Missing usage retains the reservation; cancellation prevents new
calls and preserves saved grades. Unsampled, failed and budget-stopped claims stay
visible. Support ratios cover graded samples only. Model grades are fallible,
potentially correlated with the writer, and separate from deterministic checks.

## Operator commands

The UI runs evaluations without a terminal. For scripted exports, use
`bash scripts/eval.sh --split held-out` or omit the split for the full benchmark;
the script runs in the evaluation container.

The legacy administrative `workbench.live_evaluate` CLI requires `--allow-paid`,
an already ingested live collection, membership and a running research worker.
Use `uv run --frozen python -m workbench.live_evaluate --help` for its arguments.
It uses the configured OpenAI judge and a separate orchestration path; it does
not reproduce the UI suite's durable judge ledger. Prefer UI suites for inspecting
saved grades and recovery. CLI exports are separate under `evals/results/live/`.

See [Verification status](BUILD_STATUS.md) for executed checks. CI uses synthetic
provider responses; actual live quality remains unmeasured. Evaluate held-out
real documents and audit judge agreement before using grades for product decisions.
