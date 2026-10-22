"""Application run creation shared by HTTP and background evaluation workers."""
from fastapi import HTTPException
from . import db
from .auth import authorize
from .config import settings
from .models import EXAMPLES


def create_run(project_id, body, user, *, evaluation_job_id=None):
    authorize(project_id, user)
    collection = db.one('SELECT * FROM collections WHERE id=%s AND project_id=%s',
                        (body.collection_id, project_id))
    if not collection:
        raise HTTPException(404, 'Collection not found')
    if body.mode == 'demo':
        if body.question not in EXAMPLES:
            raise HTTPException(
                422,
                'Demo supports the five seeded questions shown in Examples. Use live mode for arbitrary questions; demo will not fabricate research.'
            )
        if body.web_enabled or collection['embedding_config'] != 'demo-v1':
            raise HTTPException(422, 'Demo requires a fixture collection and does not call the web')
    else:
        s = settings()
        if not s.live_enabled or not s.openai_api_key:
            raise HTTPException(409, 'Live mode is not configured; no scripted fallback will occur')
        if collection['embedding_config'] != 'openai-small-v1':
            raise HTTPException(
                422,
                'Create and ingest a live embedding collection; fixture vectors cannot be mixed')
        if any(x is None or x < 0 for x in [
                s.model_input_usd_per_million, s.model_output_usd_per_million,
                s.embedding_usd_per_million
        ]):
            raise HTTPException(
                409, 'Configure model and embedding cost estimates before live execution')
        if body.web_enabled and (not s.tavily_api_key or s.web_search_usd_per_call is None):
            raise HTTPException(409,
                                'Web search needs a key and a configured per-call cost estimate')
    request = body.model_dump(mode='json')
    with db.connection() as conn:
        prior = conn.execute(
            'SELECT * FROM research_runs WHERE project_id=%s AND user_id=%s AND idempotency_key=%s',
            (project_id, user, body.idempotency_key)).fetchone()
        if prior:
            if prior['request'] != {**request}:
                raise HTTPException(409, 'Idempotency key already belongs to a different request')
            return prior
        versions = conn.execute(
            'SELECT d.current_version_id AS id FROM source_documents d WHERE d.project_id=%s AND d.collection_id=%s AND d.current_version_id IS NOT NULL ORDER BY d.id',
            (project_id, body.collection_id)).fetchall()
        snapshot = [str(v['id']) for v in versions]
        run = conn.execute(
            'INSERT INTO research_runs(id,project_id,collection_id,user_id,question,mode,strategy,request,corpus_versions,idempotency_key,evaluation_job_id) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(project_id,user_id,idempotency_key) DO NOTHING RETURNING *',
            (db.uid(), project_id,
             body.collection_id, user, body.question, body.mode, body.strategy, db.jsonb(request),
             db.jsonb(snapshot), body.idempotency_key, evaluation_job_id)).fetchone()
        if not run:
            run = conn.execute(
                'SELECT * FROM research_runs WHERE project_id=%s AND user_id=%s AND idempotency_key=%s',
                (project_id, user, body.idempotency_key)).fetchone()
            if run['request'] != request:
                raise HTTPException(409, 'Idempotency key collision')
    db.event(run, 'queued', 'queued', 'Durable job queued')
    return run

