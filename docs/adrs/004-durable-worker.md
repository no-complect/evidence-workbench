# ADR 004: Research outlives HTTP requests

Status: implemented; verification scope is recorded in [BUILD_STATUS](../BUILD_STATUS.md).

Next.js submits to FastAPI, which persists a queued run and returns 202. An independently hosted Python process leases jobs, heartbeats, recovers expired work and resumes LangGraph checkpoints. Browser polling reads persisted events; a disconnected browser is not a cancellation signal.

This adds a worker deployment but avoids an unbounded Vercel request and separates scheduling from graph persistence. Session locks and idempotent records reduce duplicate effects. They cannot guarantee exactly-once provider charges across a process crash. Vercel-native durable execution is not assumed and would require a separate, verified architecture decision.
