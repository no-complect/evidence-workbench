# Troubleshooting

Start with service status and recent logs:

```bash
docker compose ps
docker compose logs --tail=100 api worker ingestion-worker eval-worker web
```

| Symptom | What to check |
| --- | --- |
| Docker unavailable | Start Docker Desktop and check `docker info`. Restricted shells may need Docker socket access. |
| Port already in use | Free ports 3000/8000/55432 or set `WORKBENCH_WEB_PORT`, `WORKBENCH_API_PORT` and `WORKBENCH_DB_PORT` in `.env`. |
| First build cannot download dependencies | Check registry/network/proxy access and retry startup. Keep the committed lockfiles. |
| Local demo rejects the hostname | Open `http://localhost:3000` or `http://127.0.0.1:3000` directly, using your chosen web port. |
| Workspace setup is incomplete | Expand the setup details, correct the named settings and restart the affected services. Rebuild Next.js after changing `NEXT_PUBLIC_*`. |
| API unavailable | Check API health/logs, `API_URL` and matching `API_SHARED_SECRET` values. A hosted frontend needs a reachable HTTPS backend, not your laptop's localhost. |
| `vector` type not found | Use the pgvector database image. On Supabase, enable the vector extension and check the `public,extensions` search path. |
| A job stays queued | Check `worker` for research, `ingestion-worker` for uploads and `eval-worker` plus `worker` for evaluations. They must share the correct database/storage. |
| Awaiting approval | Review the saved plan and select **Approve & investigate**. |
| Partial report or slow cancellation | Inspect limits/events. Budget exhaustion preserves partial evidence; cancellation waits for in-flight operations to finish or time out. |
| Live mode unavailable | Set `LIVE_ENABLED=true` and provider keys on the Python API/workers, then create a live collection. OpenAI embeddings are required even with Anthropic research. Missing rates leave dollar estimates unavailable. |
| Custom question rejected in demo | Use a supplied question or configure live execution. |
| Uploaded demo file has zero vectors | New demo uploads support keyword search. Live collections provide embeddings for arbitrary documents. |
| Upload rejected or interrupted | Check file errors and retry explicitly. Supported inputs are UTF-8 text, Markdown and text-based, nonencrypted PDFs within the documented limits; OCR is unavailable. |
| Old citation shows an older document | Runs pin source versions at submission. Replacing a document affects new runs; existing citations retain their original passages. |
| Evaluation panel empty | Queue a benchmark or collection suite and check both evaluation and research workers. See [Evaluation](EVALUATION.md). |
| MCP access denied | Check project ID and backend secret; Supabase mode also needs a current member access token. |

For environment requirements, see [Deployment](DEPLOYMENT.md). Remove credentials
and private source content before sharing logs or screenshots.
