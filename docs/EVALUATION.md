# Evaluation methodology

A measured synthetic [fixture comparison](examples/fixture-comparison.md) and its [raw JSON](examples/fixture-comparison.json) are bundled as reviewed examples. They preserve the original run identifiers and version manifest; they are historical results, not a verification of every later checkout. New exports in `evals/results/` remain local and ignored. Evaluation is an engineering artifact, not a claim that iterative research is automatically better than retrieval.

## Fixture comparison

**Run from the UI:** open Evaluations, choose Development, Held-out, or All cases, then select Run benchmark. FastAPI returns a queued job immediately. The separate `eval-worker` service coordinates the comparison, while research workers execute each graph. Progress, cancellation, raw case results and the reproducibility manifest are available in the workspace. Built-in fixture jobs are limited to local/test demo instances and make no paid provider calls.

Jobs pin code, corpus-manifest and case hashes when submitted. A changed benchmark is rejected before execution. Each job owns a dedicated fixture collection; stable per-case idempotency keys allow a restarted evaluation coordinator to reuse saved research runs. Evaluation leases and a session advisory lock fence competing coordinators. Cancelling a job also requests cancellation of its unfinished child research runs.

The optional `./scripts/eval.sh` CLI runs in the evaluation container and submits research cases to the **running durable worker**. `--split held-out` limits the case set. Every strategy uses the same fixture provider, original corpus snapshot, query set, default budgets and explicit per-case limit overrides. The harness creates an isolated collection from the source manifest so user uploads cannot contaminate the benchmark, and each run pins its source versions. Expected source labels stay in `evals/cases.json`, which the research workflow does not load.

- **Basic RAG:** one question, one retrieval task, one reviewer pass, one report; no follow-up.
- **Fixed workflow:** planned subquestions, one research round, reviewer, report.
- **Bounded research:** planned subquestions, evidence assessment and up to the configured number of follow-up rounds.

The catalog has fourteen cases: comparison, security synthesis, cost baselines, stale/conflicting evidence, insufficient scale evidence, prompt injection, iteration stop, shared parallel budget, token exhaustion, authorization isolation, timeout/retry, cancellation, checkpoint process restart, and expired-lease recovery. The first nine have comparable research runs. The five infrastructure cases map to named integration tests rather than being misrepresented as language-model quality scores.

The harness exports raw JSON and a concise Markdown comparison with code/corpus/prompt/context/model identifiers, source hashes, run IDs, explicit budgets and split. The UI reads persisted `evaluation_runs` aggregates and raw per-case results. Outputs include:

- Recall@5 and MRR against manually authored **document-level** source relevance labels. These use the same independent retrieval probe for all strategies; equal results are expected and do not establish an iterative-research advantage.
- Citation existence and run/project access checks, with no-claim cases represented as ungraded in raw results.
- Exact substring support for literal fixture quotes, clearly identified as lexical support. This does not grade arbitrary synthesized claims semantically.
- Required-topic coverage from the manually authored case labels and metadata of cited passages; this is a coarse source-coverage proxy, not a semantic answer-quality score.
- Completion status, estimated/reserved tokens, observed wall latency and configured estimated cost. Fixture cost is zero; there are no live provider tokens.
- Case-specific disclosure and injection checks in raw output. Intentional budget stops lower the overall completion rate; inspect individual cases when interpreting that aggregate.

A held-out split is present, but the small hand-authored corpus and scripted answers are not statistically representative of real users. They test integration and retrieval behavior. The fixture itself mentions fictional benchmark counts; those are labeled synthetic source text and are never used as application evaluation results.

## Optional live comparison and semantic judge

An implementation is available at `workbench.live_evaluate`, but it has not been executed with paid credentials. It requires an already ingested live collection, a project member UUID, the live configuration and an explicit `--allow-paid` flag:

```bash
uv run python -m workbench.live_evaluate \
  --allow-paid --project PROJECT_UUID --collection LIVE_COLLECTION_UUID --user MEMBER_UUID \
  --question 'Your research question' --max-cost-usd 1 --max-judged-claims 5
```

Run this as a privileged local/operator CLI with the backend's environment. It checks membership, uses the ordinary submission validation, and requires the independent worker to be running. This is an administrative evaluation interface, not a public unauthenticated API.

Each of the three strategies receives an equal quarter of the configured cost cap; the final quarter is reserved across all judge calls. The harness detects collection snapshot drift and cancels invalid comparisons. Web search is disabled to keep the corpus comparable. Ingestion costs incurred before evaluation are outside its budget and should be accounted for separately.

The judge uses the same configured GPT-4.1 model family and the versioned `judge-v1` rubric. It receives a claim and its exact cited passages, then returns supported/contradicted/insufficient with a concise reason. The saved JSON records the judge model, prompt hash, selected claim hashes, evidence IDs, reported token usage and conservative cost reservations. Calls without reported usage retain the reservation; no failed call is treated as free. Ungraded claims are explicit when caps or schema failures prevent grading.

Results go into **`evals/results/live/`**, separate from fixtures, and are not blended into the demo comparison UI. Model grades are fallible and correlated with the writer; they are not human ground truth. There are no precomputed live relevance labels, so the harness does not invent recall@k, MRR or live coverage numbers. A reviewer should annotate held-out real data and audit judge agreement before using these measurements for product decisions.

## Collection suites in the UI

Choose a collection-specific evaluation to author one to six cases. Each case
has a question and either an expected source or an explicit no-evidence expectation;
an optional disclosure phrase is checked lexically. The three strategies run each
case, so six cases create eighteen investigations. Live submission displays the
run count and requires paid-call acknowledgment; editing cases clears that consent.
Corpus versions, expectations, model targets and per-run limits freeze at submission.

Expand the saved case results to inspect the question, expected evidence, retrieval
measurements, citation/quote checks and failed assertions. Execution completion and
quality checks are separate: a completed evaluation can contain failing cases.
**Open case** selects the exact child investigation in Workflows, where its report,
citations, context and events remain available. Returning to Evaluations preserves
the result inspection. Older result records without question/expectation fields
still render their original measurements.

The UI does not invoke the operator CLI's semantic judge. Its lexical checks and
retained-evidence retrieval measurements remain explicitly labeled.

## Acceptance and CI

`tests/test_integration.py` covers the real SQL/vector/graph path, source/citation authorization, approval replay, arbitrary demo rejection, iteration and budget stops, concurrent reservations, cancellation, bounded retry, expired leases and checkpoint recovery in separate OS processes. `tests/test_mcp.py` uses the real MCP SDK client. Playwright tests use the real UI/API: submit → edit plan → approve → wait → inspect citation → inspect context → export, plus ingestion and demo limitations on desktop/mobile.

Tests are implementation evidence only after execution. Consult BUILD_STATUS for what ran in this session. CI is configured to run without external inference/web calls after dependencies are installed. Live paid evaluation is never a CI default.
