# Troubleshooting

| Symptom | Action |
|---|---|
| `Docker is not accessible` | Start Docker Desktop; check `docker info` in your shell. A sandbox may deny the Docker Unix socket even when Docker is running. |
| Port already allocated / address already in use | Ports 3000, 8000, and 55432 must be free. If another copy is running, run `bash scripts/stop.sh` from that copy's directory before starting this one. |
| `Local demo requires a loopback hostname` | Open `http://localhost:3000` or `http://127.0.0.1:3000` directly. If an older copy rejects those URLs too, update the API proxy route and rebuild with `bash scripts/dev.sh --no-follow`; older builds checked the container bind address instead of the browser's Host header. |
| Registry DNS failure / `ENOTCACHED` / uv offline resolution error | The first build needs access to image and package registries. Check your network/proxy configuration and retry `bash scripts/dev.sh --no-follow`; use the committed lockfiles rather than regenerating them to fix a download failure. |
| Frontend says API unavailable | Check `docker compose ps` and API logs. Host mode needs `APP_ENV=local`; production needs a reachable HTTPS API_URL and matching shared secret. |
| Startup seed fails with `vector` type not found | Use the pgvector image, not stock Postgres. On Supabase enable the vector extension and check the public/extensions search path. |
| Production rejects demo auth or local storage | Set the full production environment matrix; this rejection is deliberate. Never disable the startup guard to deploy. |
| Run remains queued | The independent worker must be running against the same database. Inspect worker logs and `research_runs.lease_until`. |
| Run is awaiting approval | Review/edit the plan in the UI. Resume uses the existing graph thread; do not submit a replacement run. |
| Partial report | Inspect the budget event and limits. Reservations include UTF-8 input bounds, output and schema overhead. Intentionally tiny budgets are expected to return partial results. |
| Cancel takes time | Cancellation is cooperative. An in-flight provider/fetch/DB operation must return or hit its timeout before it is observed. |
| Live mode is unavailable | Set LIVE_ENABLED and credentials on both API and worker, plus all configured price estimates. Create an OpenAI embedding collection and ingest sources there. No scripted fallback is used. |
| Arbitrary question is rejected in demo | Choose one of the five examples or configure live mode. This avoids fabricated research. |
| Uploaded demo file has zero vectors | Only seeded passage hashes have fixture embeddings. New uploads remain full-text searchable. Use a live collection for arbitrary semantic embeddings. |
| PDF rejected | Only text-based, nonencrypted PDFs up to 200 pages are supported. Scanned or mixed scanned documents require OCR, which is unavailable. |
| Evidence missing after document replacement | New runs pin new versions; older runs retain their exact original evidence. Re-uploading identical bytes is idempotent. |
| Vercel cannot reach backend | Its localhost is not your laptop. Deploy API/worker separately and set API_URL to an authenticated HTTPS endpoint. |
| MCP tool request denied | Configure project ID and shared secret; production also needs the member's current access token. Tool names alone do not grant collection access. |
| Evaluation panel empty | No evaluations are saved in this local database yet. Run `bash scripts/eval.sh` with the worker running and reopen Evaluations. A historical comparison is included in `docs/examples/`. |

Never paste API keys into issues or screenshots. Worker logs report exception classes; detailed source/context inspection stays behind project authorization.
