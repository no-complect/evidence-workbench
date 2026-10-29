# syntax=docker/dockerfile:1
FROM ghcr.io/astral-sh/uv:0.12.7 AS uv
FROM python:3.12-slim AS builder
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_LINK_MODE=copy
COPY pyproject.toml uv.lock LICENSE ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project
COPY services/research/workbench ./services/research/workbench
COPY prompts ./prompts
COPY db/migrations ./db/migrations
COPY fixtures ./fixtures
COPY evals/cases.json evals/judge-cases.json ./evals/
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-editable

FROM python:3.12-slim
WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
COPY --from=builder /app/.venv /app/.venv
COPY scripts/demo.py ./scripts/demo.py
RUN useradd --create-home --uid 10001 workbench && mkdir -p /data/objects /data/credentials /app/evals/results && chmod 700 /data/credentials && chown -R workbench:workbench /data /app/evals/results
USER workbench
CMD ["python", "-m", "workbench.worker"]
