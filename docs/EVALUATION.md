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
a general advantage for iterative research. Run the benchmark on the revision
being evaluated to obtain its measurements and version manifest. Exports remain
local and ignored under `evals/results/`.

Evaluation fingerprints include every file in the prompt directory. Removing
superseded prompts changes those fingerprints even when the active prompts are
unchanged. Queued evaluations pinned to the previous file set must be resubmitted;
the existing compatibility check rejects changed inputs. Saved results remain readable.

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
its authorized passages under the versioned `judge-v2` rubric. The rubric checks
every material assertion, including document versus system scope and unsupported
process or timing inferences. Missing information is insufficient evidence, not
an explicit contradiction. Saved results include supported/contradicted/insufficient
judgments, concise reasons, model and
contract hashes, source identities and usage. Raw provider responses and private
chain-of-thought are not retained.

Grading has separate suite-wide limits. The UI starts with 6,000 tokens, 120 seconds,
two claims per investigation and a $0.25 estimated-cost cap at pinned rates. Unknown
rates disable dollar estimates/enforcement; token/sample/time limits still apply.
Research limits and costs are separate. Ingestion embedding costs precede the
suite and are outside its budget.

The durable claim ledger reserves before inference and reuses final grades after
recovery. An ambiguous reserved call is explicitly ungraded and is not retried
automatically. Missing usage retains the reservation; cancellation prevents new
calls and preserves saved grades. Unsampled, failed and budget-stopped claims stay
visible. Support ratios cover graded samples only. Model grades are fallible,
potentially correlated with the writer, and separate from deterministic checks.
Versioned writer and judge instructions are shared with the Harness inspector;
the operator CLI uses the same judge rubric. A changed prompt fingerprint stops
pending execution rather than silently changing a submitted experiment. Saved
reports and grades remain readable. Deterministic provider tests check this
wiring and recovery behavior; they do not establish live semantic accuracy.

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

## Judge challenge calibration

The operator-only `workbench.calibrate_judge` command evaluates the judge directly,
without generating research reports or embedding documents. Its versioned
[development set](../evals/judge-cases.json) contains 18 synthetic, author-annotated
claims: six supported, six contradicted and six insufficient. Contrastive cases
cover document versus system scope, missing backup schedules, separate processes,
compound claims, explicit contradictions, proposal qualifiers, synthetic results,
multiple sources and embedded source instructions. The reference annotations are
reviewable assumptions, not independently established ground truth or held-out data.

Validate the set offline (the default makes no model calls and reads no credentials):

```bash
uv run --frozen python -m workbench.calibrate_judge
```

For a deliberately authorized live calibration, use `--live --allow-paid` and an
explicit `--model`. Existing server credentials and `LIVE_ENABLED=true` are required.
For example, the following would request **at most six judge calls**, with 24,000
suite tokens, 120 seconds and an optional $0.25 estimate cap:

```bash
uv run --frozen python -m workbench.calibrate_judge \
  --live --allow-paid --model gpt-4.1 \
  --max-calls 6 --tokens 24000 --wall-seconds 120 --max-cost-usd 0.25
```

Calls follow dataset order. Repeat `--case ID` to choose a smaller explicit subset.
Cases beyond any limit remain ungraded. Prices apply only when configured for the
selected model; otherwise estimates and dollar enforcement are unavailable while
token/time/call limits remain. A conservative reservation may stop execution before
reported usage reaches the token limit. Reported over-reservation usage stops new
calls. The existing OpenAI/Anthropic structured adapter, `judge-v2` rubric and
cited-passages/redaction boundary are reused. Labels and annotation rationales
never enter the model input. This command adds no UI grading controls or new rubric.

Each run saves a new ignored report under `evals/results/judge-calibration/`,
including dataset/implementation/prompt/schema/model fingerprints, selected IDs,
per-call input provenance, usage and scores. Reservations are saved before sending;
unknown outcomes retain their reservations. Provider failures or invalid outputs
stop without retries. A storage failure stops execution; an interrupted reservation
stays ambiguous. This diagnostic command does not resume or replace the durable UI
suite ledger. Starting another live command is a fresh, potentially charged run.

Rescore a saved report offline using its printed path:

```bash
uv run --frozen python -m workbench.calibrate_judge --predictions PATH_TO_REPORT.json
```

Changed dataset fingerprints and unknown or duplicate case IDs are rejected.
Inspect the confusion matrix, per-case errors, per-label recall and **false support
rate** (unsupported reference claims incorrectly labeled supported / graded
non-supported reference claims). Always read the denominator and grading coverage;
missing, reserved, failed and skipped outcomes are not correct predictions. A rate
with no observations stays unavailable. Accuracy on a small completed subset is
not full-suite accuracy. A synthetic always-supported judge has a 100% false support
rate on this balanced set, rather than appearing successful merely for producing
valid structured output. CI tests the harness with stubbed responses; it establishes
no live agreement rate, research improvement or correctness of the judge's reasons.

See [Verification scope](DEVELOPMENT.md#verification-scope) for CI evidence and limits.
CI uses synthetic provider responses and does not establish live semantic accuracy. Evaluate held-out
real documents and audit judge agreement before using grades for product decisions.
