FROM ghcr.io/astral-sh/uv:0.12.7 AS uv
FROM python:3.12-slim
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app
COPY . .
RUN uv sync --frozen --no-dev
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
RUN useradd --create-home --uid 10001 workbench && mkdir -p /data/objects /app/evals/results && chown -R workbench:workbench /data /app/evals/results
USER workbench
CMD ["python", "-m", "workbench.worker"]
