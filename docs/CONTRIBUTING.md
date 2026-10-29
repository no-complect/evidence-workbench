# Contributing

Start with the [first investigation](../README.md#first-investigation), then use
[Development](DEVELOPMENT.md) for host setup and test commands.

Keep changes focused and describe the user-visible behavior and checks performed.
Include reproduction steps for bugs, the execution mode, and relevant dependency
versions. Remove credentials and private source content from logs or screenshots.

Preserve project-scoped authorization, immutable source provenance, explicit demo
limitations, and bounded execution. Changes to Pydantic request/response models must
regenerate `packages/contracts/models.ts` and pass the contract check. Database
changes belong in a new ordered migration, not edits to an applied migration.

Run `./scripts/test.sh` for unit tests, contracts, TypeScript, and the production
frontend build. Retrieval, authorization, and worker changes also need the real
integration suite against a disposable pgvector database. UI changes should pass
the real desktop/mobile Playwright journey. CI uses no paid inference.

Use `python3 scripts/check-publication.py` before committing new files. Commit
lockfiles and runtime assets; exclude credentials, uploaded sources, caches,
generated reports, and local execution artifacts.

## Updating the architecture diagram

Edit `docs/diagrams/architecture.mmd`, then regenerate both rendered formats with
Mermaid CLI installed. Run from the repository root:

```bash
mmdc -i docs/diagrams/architecture.mmd -o docs/diagrams/architecture.svg -c docs/diagrams/mermaid-config.json -b white -w 1600
mmdc -i docs/diagrams/architecture.mmd -o docs/diagrams/architecture.png -c docs/diagrams/mermaid-config.json -b white -w 1600 -s 2
```

PNG works in Markdown viewers; SVG supports scaling. Mermaid tooling is optional
and is not needed to run the app.
