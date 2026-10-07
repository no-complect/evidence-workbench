# Contributing

Start with the [README walkthrough](README.md#five-minute-reviewer-walkthrough).
Use [Development and tests](docs/DEVELOPMENT.md) for host setup and verification.

Keep changes focused and describe the user-visible behavior and checks performed.
Include reproduction steps for bugs, the execution mode, and relevant dependency
versions. Remove credentials and private source content from logs or screenshots.

Preserve project-scoped authorization, immutable source provenance, explicit demo
limitations, and bounded execution. Changes to Pydantic request/report models must
regenerate `packages/contracts/models.ts` and pass the contract check. Database
changes belong in a new ordered migration, not edits to an applied migration.

Run `./scripts/test.sh` for unit tests, contracts, TypeScript, and the production
frontend build. Retrieval, authorization, and worker changes also need the real
integration suite against a disposable pgvector database. UI changes should pass
the real desktop/mobile Playwright journey. CI uses no paid inference.

Use `python3 scripts/check-publication.py` before committing new files. Commit
lockfiles and runtime assets; exclude credentials, uploaded sources, caches,
generated reports, and local execution artifacts.
