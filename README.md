# Evidence Workbench

**Ask a research question. Approve the plan. Inspect the evidence behind the answer.**

A demo research workspace that turns document collections into cited decision
briefs. Explore retrieval, review a bounded investigation, and compare research
strategies against evaluation cases you define.

Built with Next.js/React, FastAPI, LangChain, LangGraph and PostgreSQL/pgvector.
Research, ingestion and evaluation run in independent background workers.

## Running the application

Start Docker with Compose v2. Use Bash on macOS/Linux, or WSL2 with Docker Desktop
integration on Windows. The first build needs internet access and available ports
3000, 8000 and 55432. Host Python and Node installations are unnecessary.

```bash
git clone https://github.com/no-complect/evidence-workbench.git
cd evidence-workbench
bash scripts/dev.sh --no-follow
```

Open **[http://localhost:3000](http://localhost:3000)**. Startup creates `.env` if
absent, builds the containers, applies migrations and loads synthetic sources.
The local demo needs no account or API key. Responses and topic vectors are
scripted; database retrieval, approval, persistence and evaluation execution are real.

Stop with `bash scripts/stop.sh`; restart with the startup command above. Database
and uploaded files are retained. See [Troubleshooting](docs/TROUBLESHOOTING.md) if
startup fails. The supplied Compose stack is for local use; see
[Deployment](docs/DEPLOYMENT.md) before exposing an instance publicly.

## First investigation

1. In **Harness**, inspect the instructions, context policy and execution limits.
   Validating a contract sample makes no model calls.
2. Open **Workflows**. Use the **Enterprise AI architecture** project,
   **Architecture decision pack** collection and supplied comparison question.
   Select **Start research**, review the plan, then **Approve & investigate**.
3. Inspect **Research trail**, **Evidence board** and **Decision brief**. Citations
   open passages from the source versions pinned to the investigation. Export the
   brief as Markdown.
4. Open **Context** or an execution node to inspect the saved redacted model input
   and passage-selection decisions.

To try your own documents, use **RAG → Add Collection**. Follow the walkthrough,
upload [these example notes](docs/examples/reviewer-notes.txt), then try keyword
search. Uploads accept UTF-8 text, Markdown and text-based PDFs: up to 8 MiB per
file, 20 files per batch and 200 PDF pages. Scanned PDFs require OCR, which is
unavailable. New demo uploads support keyword search; fixture vector search uses
recognized topics from the bundled corpus.

In **Evaluations**, compare Basic RAG, Fixed workflow and Bounded research. Use a
built-in benchmark or author a collection suite, inspect failed checks and open
the exact child investigation. See [Evaluation](docs/EVALUATION.md) to interpret results.

## Live models

For local Compose, set these in the root `.env`:

```dotenv
OPENAI_API_KEY=your-server-key
LIVE_ENABLED=true
# Optional second model provider:
ANTHROPIC_API_KEY=your-server-key
```

Restart the Python services, refresh models in **Harness**, then choose a model.
Create a live collection and explicitly authorize live research or evaluation in
the UI. Live retrieval uses OpenAI `text-embedding-3-small` embeddings, including
when research or grading uses Anthropic. Existing collections keep their original
embedding profile.

A model appearing in the catalog does not guarantee inference permission or the
structured-output support research requires. Token, tool, iteration and time
limits apply; dollar estimates require configured rates, and dollar caps cannot
cover unpriced calls. File-preparation
embedding costs are recorded separately from research budgets. See
[configuration](docs/DEPLOYMENT.md#environment-matrix) for pricing and optional web
search settings. Provider keys belong on the Python services; never use `NEXT_PUBLIC_*`.

## How it works

![Next.js proxies requests to FastAPI; research, ingestion and evaluation workers share Postgres and private storage.](docs/diagrams/architecture.png)

[Scalable diagram](docs/diagrams/architecture.svg) · [Architecture](docs/ARCHITECTURE.md)

The API saves jobs in Postgres. Research follows **plan → approval → gather →
assess → follow up or write → verify citations → finalize**. Workers recover saved
work after interruption; closing the browser does not cancel it. Source versions,
limits, prompts and model configuration remain pinned to the run.

This is a demo, with limited context filtering/redaction, cooperative cancellation
and no production rate limiting or automated retention. Fixture tests demonstrate
integration behavior, not live-model accuracy. See the
[verification scope](docs/DEVELOPMENT.md#verification-scope) for what CI covers.

## Documentation

- [Development](docs/DEVELOPMENT.md) — host setup and tests.
- [Architecture](docs/ARCHITECTURE.md) — service boundaries, provenance and recovery.
- [Evaluation](docs/EVALUATION.md) — benchmarks, grading and interpretation.
- [Deployment](docs/DEPLOYMENT.md) — service setup and configuration.
- [Troubleshooting](docs/TROUBLESHOOTING.md) — common problems and recovery.
- [Contributing](docs/CONTRIBUTING.md) · [Security](docs/SECURITY.md).

[MIT](LICENSE). The bundled corpus is synthetic and contains no employer data.
Dependencies retain their own licenses.
