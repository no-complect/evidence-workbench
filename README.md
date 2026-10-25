# Evidence Workbench

**Ask a research question. Approve the plan. Inspect the evidence behind the answer.**

A research workspace for turning document collections into cited decision briefs. Configure a model harness, retrieve relevant passages, review a bounded investigation, and compare research strategies against your own evaluation cases.

Built with Next.js/React, FastAPI, LangChain, LangGraph and PostgreSQL/pgvector. Research and evaluation run in separate durable workers.

## Running the application

Install and start Docker with Compose v2. Use Bash on macOS/Linux, or WSL2 with Docker Desktop integration on Windows. The first build needs internet access and available ports 3000, 8000 and 55432; host Python and Node installations are unnecessary.

```bash
git clone https://github.com/no-complect/evidence-workbench.git
cd evidence-workbench
bash scripts/dev.sh --no-follow
```

Open **[http://localhost:3000](http://localhost:3000)**. Startup creates `.env` from the example only if absent, builds the containers, applies migrations and loads synthetic sources. It starts the API, research, evaluation and ingestion workers and website, then waits for readiness.

The default local mode needs no account or API key. Responses and topic vectors are **scripted fixtures**; database retrieval, orchestration, approval, persistence and evaluation execution are real. Arbitrary questions and live embeddings require [live configuration](#live-models). Local demo credentials and loopback bindings are unsuitable for a public deployment.

Stop with `bash scripts/stop.sh`; restart with the startup command above. Database and uploaded documents are retained. For startup failures, inspect `docker compose ps` and `docker compose logs --tail=100 api worker ingestion-worker eval-worker web`, then consult [Troubleshooting](docs/TROUBLESHOOTING.md).

## First investigation

The workspace opens in **Harness**. Configuration drafts survive workspace navigation; switching project or user resets local state. Background runs continue after the browser closes.

1. **Harness:** inspect instructions, context policy, contracts and execution limits. Save an immutable preset to reuse a configuration. Contract sample validation makes no model calls.
2. **Workflows:** use the **Enterprise AI architecture** project, **Architecture decision pack** collection and supplied comparison question. Select **Start research**, inspect or edit the plan, then **Approve & investigate**.
3. Inspect **Research trail**, **Evidence board** and **Decision brief**. Numbered citations open exact passages from the source versions pinned at submission. Export the brief as Markdown.
4. Open **Context** or an execution node to inspect the saved redacted model input: instructions, user requirements, workflow state, untrusted passages and selection decisions. Expanding the record reveals hashes and raw redacted input; private chain-of-thought is not requested or displayed.
5. **RAG → Add Collection:** follow **Purpose → Sources → Review → Try it** with a bundled pack or your own files. Inspect ingestion results, retry failures and compare Keyword, Vector and Hybrid retrieval. A project without a collection guides setup and returns to the preserved research draft without starting it automatically.
6. **Evaluations:** run a built-in benchmark, or author a collection suite with one to six cases and explicit expected sources or no-evidence expectations. Inspect failed checks and open the exact child investigation. Evaluation completion and quality success are separate.

Local scripted mode accepts the supplied research questions. Custom uploads such as [example notes](docs/examples/reviewer-notes.txt) support keyword search; fixture vector search requires recognized topics. Live collections use real embeddings. Uploads accept UTF-8 text, Markdown and text-based PDF, with limits of 8 MiB/file, 20 files/batch and 200 PDF pages. Failed replacements preserve the previous usable source version.

## Live models

Set server environment variables in the root `.env` for local Compose, or on the deployed **Python API and research, evaluation and ingestion workers**:

```dotenv
OPENAI_API_KEY=your-server-key
LIVE_ENABLED=true
# Optional second model provider:
ANTHROPIC_API_KEY=your-server-key
```

Restart the affected services after changes. **Harness → Refresh models** lists all IDs returned by configured OpenAI and Anthropic accounts; Anthropic discovery follows pagination. Choose the research model, optional per-stage targets and an independent evaluation judge. Model discovery works without enabling live execution and makes no inference calls. A listed model may still lack inference permission or the strict structured-output support required by research; execution reports those errors without scripted fallback.

**Live RAG requires OpenAI `text-embedding-3-small` embeddings**, even when research and grading use Anthropic. Create a live collection rather than changing an existing collection's immutable embedding profile. In Workflows, select Live and explicitly authorize execution. Collection evaluations have their own paid-call acknowledgment and optional grading settings.

Run snapshots pin model/provider adapters, prompts, contracts, context policy, limits and source versions. Token, tool, iteration and time limits apply. Dollar estimates require configured rates; dollar caps cannot bound unpriced calls. UI uploads prepare in a durable background worker; embedding costs remain outside the research-run ledger. Optional public-web research requires Tavily configuration.

For required/optional settings, missing-configuration behavior and separate Next.js build variables, see [Deployment and configuration](docs/DEPLOYMENT.md). Setting provider keys only on a separately deployed Vercel frontend does not configure the Python services. Never expose keys through `NEXT_PUBLIC_*`.

## How it works

![Next.js calls FastAPI through its proxy; separate workers execute research and evaluations using Postgres, retrieval and persisted checkpoints.](docs/diagrams/architecture.png)

[Scalable diagram](docs/diagrams/architecture.svg) · [Architecture and boundaries](docs/ARCHITECTURE.md)

The API queues a run in Postgres. LangGraph executes **plan → approval → gather → assess → follow up or write → verify citations → finalize**. Basic RAG retrieves once; a fixed workflow investigates planned subquestions once; bounded research can follow gaps within its limits. Keyword and vector results combine through reciprocal-rank fusion.

Workers lease jobs and resume checkpoints. Parallel tasks share database budget reservations. Cancellation is cooperative and preserves saved evidence. External calls can repeat across a crash window; inference is not exactly-once. Hosted authorization uses Supabase Auth, project membership, RLS and private Storage. A read-only MCP interface exposes search, evidence and run status.

## Documentation

- [Development and tests](docs/DEVELOPMENT.md) — host setup, container/browser checks and contribution checks.
- [Architecture](docs/ARCHITECTURE.md) — state, authorization, provenance, context and recovery.
- [Evaluation methodology](docs/EVALUATION.md) — deterministic measures, model grades and their interpretation.
- [Deployment](docs/DEPLOYMENT.md) — configuration, service topology and hosted validation.
- [Verification status](docs/BUILD_STATUS.md) — measured evidence and outstanding live/hosted checks.
- [Troubleshooting](docs/TROUBLESHOOTING.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md).

OCR, reranking, invitation UI, production rate limiting and automated retention are not implemented. Context filtering/redaction is limited; exact quotes do not establish semantic correctness. Fixture tests establish integration behavior, not live-model quality or hosted availability.

[MIT](LICENSE). The bundled synthetic corpus contains no employer data. Dependencies retain their own licenses.
