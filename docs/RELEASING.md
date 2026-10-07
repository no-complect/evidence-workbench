# Preparing a public repository

## Files to publish

Keep application source, `compose.yaml`, both Dockerfiles, executable scripts,
database migrations, generated TypeScript contracts, synthetic fixtures and their
manifest, prompts, evaluation cases, tests, `.github/workflows/ci.yml`,
`.env.example`, both dependency lockfiles, `LICENSE`, and user-facing docs.

Keep the reviewed examples in `docs/examples/`. The JSON comparison preserves
the original reproducibility manifest; its metrics describe that historical
fixture run rather than all later source revisions.

Keep `docs/diagrams/` as documentation assets, including the PNG/SVG images and
editable Mermaid source. These are intentionally published so reviewers can see
the architecture without installing a diagram renderer.

## Files to retain locally

The ignore rules exclude `.env` and environment variants, `.venv`, `node_modules`,
`.next`, Python/tool caches, `.runtime` uploads and logs, Playwright artifacts,
TypeScript incremental files, generated `evals/results/*`, raw
`docs/verification/*`, local cloud/editor configuration directories, private key files,
and the original authoring prompt. None is needed to run a fresh checkout.

There is no need to delete your local environments or uploaded documents to
publish source. **Ignore rules do not remove files already tracked by Git.**
Inspect staged files and untrack any accidental artifacts before publishing.

## Local preflight

```bash
python3 scripts/check-publication.py
```

This works before `git init`. It checks the candidate file set using Git's ignore
rules in a temporary repository, verifies essential assets, and scans for common
credential patterns, private keys, machine-specific home paths, and oversized
files. Once this directory is a Git repository it checks tracked files as well,
so an ignored but already tracked `.env` is an error. It never prints secret
values. It is a useful preflight, not an exhaustive secret scanner.

Before the first public push:

1. Run the quick start from a fresh checkout with no local `.env`, dependencies,
   generated files, or existing database volumes. Confirm `./scripts/demo.sh`
   completes and the README walkthrough works.
2. Pass unit/contracts/frontend checks, real integration tests, and the
   desktop/mobile journey. Update [BUILD_STATUS](BUILD_STATUS.md) with measured
   results. Do not publish unverified behavior as a passed check.
3. Run `git diff --cached --check` and inspect `git diff --cached --stat` and
   `git ls-files`. Confirm shell scripts retain executable mode. Review the
   sample environment, examples, license, and dependency locks.
4. Review the entire history if this is not the first commit; a clean working
   tree does not remove secrets from earlier commits. Rotate any real credential
   that was exposed.
5. Create the GitHub repository with a short description and enable private
   vulnerability reporting. Push the reviewed source and confirm CI passes.
6. Add a genuine synthetic-demo screenshot after browser verification. Set a
   description such as: “Evidence-first research workspace with cited reports,
   inspectable context, and durable bounded workflows. Local Docker demo.”

The public source repository can be runnable without provisioning a hosted demo.
Deployment and paid inference remain separate choices.
