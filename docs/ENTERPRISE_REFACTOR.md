# Evidence Workbench — enterprise harness refactor

Baseline: `50baf80` on `main`. This is an incremental refactor of the existing
Next.js, FastAPI, Postgres/pgvector and LangGraph application.

## Target experience

Use the approved light notebook design: warm neutral gray, readable charcoal text,
gunmetal framing and restrained cool accents. Preserve the evidence inspector and
icons. Avoid yellow, heavy beige, and a Jev-style dark dashboard.

Four workspaces expose real operations through the UI:

| Workspace | User operations | Existing foundation | Refactor needed |
|---|---|---|---|
| Harness | Connect providers, discover account-scoped models, select task targets, save revisions, inspect contracts and context | Strict Pydantic outputs, versioned prompts, budget reservations, context traces, demo/OpenAI adapters | Server-side local credential storage, provider adapters and catalog discovery, capability verification, immutable harness revisions and run snapshots |
| RAG | Create a collection through a walkthrough, upload or load examples, inspect ingestion and source versions, compare retrieval modes | Versioned documents, content hashes, chunk offsets, full-text/vector hybrid search | Collection wizard, clear upload states and retry behavior, individual retrieval-mode inspection, ingestion regression tests |
| Workflows | Run RAG, fixed workflow or bounded agent strategies; approve plans; inspect graph nodes, citations, budgets, cancellation and recovery | LangChain provider boundary, LangGraph execution and checkpoints, research worker leases, scoped tools, human approval, events and provenance | Separate workspaces from the current large Workbench component, inspectable workflow and harness snapshots, approved notebook presentation |
| Evaluations | Queue benchmarks, inspect progress, cancel, compare strategy results, inspect failing cases and manifests | Fixture benchmark runner, live operator evaluation script, aggregate results | Dedicated durable evaluation service, UI execution controls, saved raw results, later custom collection suites and explicitly authorized live model comparisons |

## Execution boundaries

- The browser uses the existing authenticated Next.js proxy.
- FastAPI validates and enqueues jobs; it does not execute a benchmark in a request.
- The research worker executes model/retrieval graphs and retains its checkpoints.
- The evaluation worker coordinates benchmark cases through research runs, with
  independent scheduling, leases, cancellation, idempotency and recovery.
- Postgres owns durable jobs, experiment snapshots, results and source versions.
- Demo operation remains self-contained and requires no provider credentials.

## Stage 1: evaluation service

Implemented on the refactor branch:

- Separate application run creation from HTTP adapters so evaluation execution no
  longer imports the FastAPI application.
- Add the evaluation job queue, scoped API and `eval-worker` Compose service.
- Run fixture benchmarks from the UI with split selection, progress, cancellation,
  aggregate comparisons, raw case inspection and the reproducibility manifest.
- Freeze a dedicated fixture collection per job; stable case idempotency keys
  reuse completed research runs after a coordinator restart.
- Reject benchmark source/case/code drift after enqueueing. Keep deterministic
  benchmark results distinct from live-model quality claims.

Integration tests cover authorization, duplicate submissions, queue cancellation,
restart recovery, active cancellation and code drift. They require pgvector Postgres
and run in the existing GitHub Actions verification job. Docker/Postgres are not
available in the current editing environment; do not claim those tests passed
locally unless that environment is supplied.

## Remaining stages, in dependency order

1. **Collection walkthrough and upload reliability.** Separate collection creation
   from research mode. Let users choose the bundled synthetic collection or their
   own Markdown/text/text-PDF sources. Show validation, indexing and per-file
   failure/retry states. Explain that fixture vectors cover only fixture passages;
   arbitrary uploads need a real embedding profile for semantic retrieval. Pin
   embedding model/dimension to an index, with explicit reindexing for changes.
2. **Local provider connections and immutable harness profiles.** Store keys on the
   server in the user's local installation, never in browser storage or traces.
   Discover provider catalogs using the configured credential and endpoint, then
   verify task capabilities and inference access. Catalog listing alone does not
   prove a model can execute a structured-output or embedding task. Save planner,
   writer and judge targets with prompt/contract/context/tool/budget versions in
   immutable experiment revisions. Start with the existing provider boundary;
   expand adapters without replacing LangChain/LangGraph.
3. **Approved notebook workspaces.** Split the large Workbench state/UI into
   project navigation, Harness, RAG, Workflows and Evaluations. Apply the approved
   visual system and retain accessible source/context/activity inspectors. Wire
   controls to real APIs; keep explicit empty/error/loading states.
4. **Collection-specific and model-backed evaluations.** Add user-authored case
   suites pinned to corpus and harness revisions; compare configurations with
   deterministic checks plus separately labeled judge assessments. Require an
   explicit cost budget for live comparisons. Extend recovery and UI journey tests.

## Completion criteria

A reviewer can clone the repo, launch Compose, prepare a collection, inspect a
harness revision, run and approve a workflow, trace a claim to an immutable source,
cancel/recover a run, and compare evaluations entirely through the UI. Offline
fixture paths and actual provider calls remain clearly distinguished. The
portfolio's target-design preview is not evidence that unfinished stages exist.
