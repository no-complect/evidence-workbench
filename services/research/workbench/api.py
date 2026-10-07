from contextlib import asynccontextmanager
from uuid import UUID
from fastapi import FastAPI, Depends, File, UploadFile, HTTPException, Query
from fastapi.responses import Response
from . import db
from .config import settings
from .auth import identity, authorize
from .models import RunCreate, RunSummary, Plan, Named, CollectionCreate, SearchRequest, EXAMPLES
from .ingest import ingest, IngestionError, MAX_BYTES
from .evidence import for_run, markdown
from .storage import storage
from .retrieval import search


@asynccontextmanager
async def lifespan(app):
    settings()  # Fail closed before accepting traffic.
    yield


app = FastAPI(title='Evidence Workbench', version='0.1.0', lifespan=lifespan)


def serialize(value):
    return db.serial(value)


def get_run(project_id, run_id, user):
    authorize(project_id, user)
    run = db.one('SELECT * FROM research_runs WHERE id=%s AND project_id=%s', (run_id, project_id))
    if not run:
        raise HTTPException(404, 'Run not found')
    return run


@app.get('/health')
def health():
    try:
        db.one('SELECT 1')
    except Exception as exc:
        raise HTTPException(503, 'Database unavailable') from exc
    return {'status': 'ok', 'version': '0.1.0'}


@app.get('/api/bootstrap')
def bootstrap(user=Depends(identity)):
    projects = db.all_rows(
        'SELECT p.* FROM projects p JOIN project_memberships m ON p.id=m.project_id WHERE m.user_id=%s ORDER BY p.created_at,p.id',
        (user, ))
    s = settings()
    return serialize({
        'projects': projects,
        'examples': EXAMPLES,
        'auth_mode': s.auth_mode,
        'live_enabled': s.live_enabled,
        'mode_notice':
        'Demo uses scripted responses and synthetic documents. Real retrieval, checkpoints and events.',
        'version': '0.1.0'
    })


@app.post('/api/projects', status_code=201)
def create_project(body: Named, user=Depends(identity)):
    project_id = db.uid()
    with db.connection() as conn:
        conn.execute('INSERT INTO projects(id,name) VALUES(%s,%s)', (project_id, body.name))
        conn.execute("INSERT INTO project_memberships VALUES(%s,%s,'owner')", (project_id, user))
    return {'id': project_id, 'name': body.name}


@app.get('/api/projects/{project_id}')
def project(project_id: UUID, user=Depends(identity)):
    authorize(project_id, user)
    return serialize({
        'collections':
        db.all_rows(
            'SELECT c.*,(SELECT count(*) FROM source_documents d WHERE d.collection_id=c.id) AS document_count FROM collections c WHERE c.project_id=%s ORDER BY c.created_at',
            (project_id, )),
        'runs':
        db.all_rows(
            'SELECT id,question,status,mode,strategy,created_at FROM research_runs WHERE project_id=%s ORDER BY created_at DESC LIMIT 40',
            (project_id, ))
    })


@app.post('/api/projects/{project_id}/collections', status_code=201)
def create_collection(project_id: UUID, body: CollectionCreate, user=Depends(identity)):
    authorize(project_id, user)
    if body.embedding_config == 'openai-small-v1' and not settings().live_enabled:
        raise HTTPException(409, 'Enable live mode before creating a live embedding collection')
    cid = db.uid()
    db.execute('INSERT INTO collections(id,project_id,name,embedding_config) VALUES(%s,%s,%s,%s)',
               (cid, project_id, body.name, body.embedding_config))
    return {'id': cid, 'name': body.name, 'embedding_config': body.embedding_config}


@app.get('/api/projects/{project_id}/collections/{collection_id}/sources')
def sources(project_id: UUID, collection_id: UUID, user=Depends(identity)):
    authorize(project_id, user)
    return serialize(
        db.all_rows(
            'SELECT d.*, (SELECT count(*) FROM source_versions v WHERE v.document_id=d.id) AS version_count,(SELECT count(*) FROM chunks c WHERE c.version_id IN (SELECT id FROM source_versions WHERE document_id=d.id)) AS chunk_count FROM source_documents d WHERE d.project_id=%s AND d.collection_id=%s ORDER BY d.name',
            (project_id, collection_id)))


@app.post('/api/projects/{project_id}/collections/{collection_id}/sources', status_code=201)
def upload(project_id: UUID,
           collection_id: UUID,
           file: UploadFile = File(...),
           user=Depends(identity)):
    authorize(project_id, user)
    data = file.file.read(MAX_BYTES + 1)
    try:
        return ingest(project_id, collection_id, file.filename or 'upload.txt', data, {
            'synthetic': False,
            'uploaded': True
        })
    except IngestionError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post('/api/projects/{project_id}/search')
def search_corpus(project_id: UUID, body: SearchRequest, user=Depends(identity)):
    authorize(project_id, user)
    try:
        return serialize(search(project_id, body.collection_id, body.query, body.top_k))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post('/api/projects/{project_id}/runs', status_code=202, response_model=RunSummary)
def create_run(project_id: UUID, body: RunCreate, user=Depends(identity)):
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
            'INSERT INTO research_runs(id,project_id,collection_id,user_id,question,mode,strategy,request,corpus_versions,idempotency_key) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(project_id,user_id,idempotency_key) DO NOTHING RETURNING *',
            (db.uid(), project_id,
             body.collection_id, user, body.question, body.mode, body.strategy, db.jsonb(request),
             db.jsonb(snapshot), body.idempotency_key)).fetchone()
        if not run:
            run = conn.execute(
                'SELECT * FROM research_runs WHERE project_id=%s AND user_id=%s AND idempotency_key=%s',
                (project_id, user, body.idempotency_key)).fetchone()
            if run['request'] != request:
                raise HTTPException(409, 'Idempotency key collision')
    db.event(run, 'queued', 'queued', 'Durable job queued')
    return run


@app.get('/api/projects/{project_id}/runs/{run_id}')
def run_detail(project_id: UUID, run_id: UUID, user=Depends(identity)):
    run = get_run(project_id, run_id, user)
    run.pop('lease_owner', None)
    return serialize({
        'run':
        run,
        'evidence':
        for_run(run),
        'contexts':
        db.all_rows('SELECT * FROM contexts WHERE run_id=%s AND project_id=%s ORDER BY created_at',
                    (run_id, project_id)),
        'tasks':
        db.all_rows(
            'SELECT * FROM research_tasks WHERE run_id=%s AND project_id=%s ORDER BY iteration,id',
            (run_id, project_id))
    })


@app.get('/api/projects/{project_id}/runs/{run_id}/events')
def events(project_id: UUID, run_id: UUID, after: int = Query(0, ge=0), user=Depends(identity)):
    get_run(project_id, run_id, user)
    rows = db.all_rows(
        'SELECT * FROM run_events WHERE run_id=%s AND project_id=%s AND id>%s ORDER BY id LIMIT 200',
        (run_id, project_id, after))
    return serialize({'events': rows, 'cursor': rows[-1]['id'] if rows else after})


@app.post('/api/projects/{project_id}/runs/{run_id}/approve', status_code=202)
def approve(project_id: UUID, run_id: UUID, body: Plan, user=Depends(identity)):
    run = get_run(project_id, run_id, user)
    if len({t.id for t in body.tasks}) != len(body.tasks):
        raise HTTPException(422, 'Task IDs must be unique')
    if run['mode'] == 'demo' and any(
            t.topic not in {'security', 'cost', 'retrieval', 'maintenance', 'unknown', 'retention'}
            for t in body.tasks):
        raise HTTPException(422, 'Demo plan topics must use the supported fixture topics')
    count = db.execute(
        "UPDATE research_runs SET status='queued',plan=%s,approved_plan=%s,deadline=now()+(%s * interval '1 second'),attempts=0,available_at=now() WHERE id=%s AND project_id=%s AND status='awaiting_approval' AND NOT cancel_requested",
        (db.jsonb(body.model_dump()), db.jsonb(
            body.model_dump()), run['request']['limits']['wall_seconds'], run_id, project_id))
    if not count:
        raise HTTPException(409, 'Run is not waiting for approval')
    return {'status': 'queued'}


@app.post('/api/projects/{project_id}/runs/{run_id}/cancel')
def cancel(project_id: UUID, run_id: UUID, user=Depends(identity)):
    run = get_run(project_id, run_id, user)
    if run['status'] in {'completed', 'failed', 'partial', 'cancelled'}:
        return {'status': run['status']}
    db.execute(
        "UPDATE research_runs SET cancel_requested=true,status=CASE WHEN status IN ('queued','retrying','awaiting_approval') THEN 'cancelled' ELSE status END,updated_at=now() WHERE id=%s AND project_id=%s",
        (run_id, project_id))
    db.event(run, 'cancel-request', 'cancel', 'Cancellation requested')
    return {'status': 'cancellation_requested'}


@app.get('/api/projects/{project_id}/runs/{run_id}/report.md')
def export(project_id: UUID, run_id: UUID, user=Depends(identity)):
    run = get_run(project_id, run_id, user)
    if not run['report']:
        raise HTTPException(409, 'Report is not ready')
    return Response(markdown(run),
                    media_type='text/markdown',
                    headers={'Content-Disposition': 'attachment; filename="research-report.md"'})


@app.get('/api/projects/{project_id}/evidence/{evidence_id}')
def evidence_lookup(project_id: UUID, evidence_id: UUID, user=Depends(identity)):
    authorize(project_id, user)
    row = db.one(
        'SELECT e.*,c.text,c.page,c.section,c.start_offset,c.end_offset,c.version_id,c.metadata FROM evidence e JOIN chunks c ON c.id=e.chunk_id AND c.project_id=e.project_id WHERE e.id=%s AND e.project_id=%s',
        (evidence_id, project_id))
    if not row:
        raise HTTPException(404, 'Evidence not found')
    return serialize(row)


@app.get('/api/projects/{project_id}/versions/{version_id}/download')
def download(project_id: UUID, version_id: UUID, user=Depends(identity)):
    authorize(project_id, user)
    row = db.one('SELECT * FROM source_versions WHERE id=%s AND project_id=%s',
                 (version_id, project_id))
    if not row:
        raise HTTPException(404, 'Source version not found')
    return Response(storage().get(row['storage_key']),
                    media_type=row['media_type'],
                    headers={
                        'Content-Disposition': 'attachment; filename="source"',
                        'X-Content-Type-Options': 'nosniff'
                    })


@app.get('/api/projects/{project_id}/evaluations')
def evaluations(project_id: UUID, user=Depends(identity)):
    authorize(project_id, user)
    return serialize(
        db.all_rows(
            'SELECT * FROM evaluation_runs WHERE project_id=%s ORDER BY created_at DESC LIMIT 20',
            (project_id, )))
