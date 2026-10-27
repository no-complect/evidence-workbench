"""Short HTTP requests enqueue work; the independent evaluation worker executes it."""
import hashlib
from uuid import UUID
import psycopg
from fastapi import APIRouter, Depends, HTTPException
from . import responses as r
from . import db
from .auth import authorize, identity
from .config import ROOT, settings
from .evaluate import fingerprint
from .models import EvaluationCreate
from .evaluation_setup import prepare_custom, evaluation_input

router = APIRouter(prefix='/api/projects/{project_id}', tags=['evaluations'])
PUBLIC_COLUMNS = ('id,project_id,status,request,progress,result_id,cancel_requested,'
                  'error,attempts,created_at,updated_at')


def benchmark_versions():
    sources = sorted((ROOT / 'fixtures/corpus').glob('*'))
    return {
        'code_sha256': fingerprint(),
        'corpus_sha256': hashlib.sha256((ROOT / 'fixtures/manifest.json').read_bytes()).hexdigest(),
        'cases_sha256': hashlib.sha256((ROOT / 'evals/cases.json').read_bytes()).hexdigest(),
        'source_files_sha256': hashlib.sha256(b''.join(
            p.name.encode() + p.read_bytes() for p in sources if p.is_file())).hexdigest(),
    }


def get_job(project_id, job_id, user):
    authorize(project_id, user)
    row = db.one(f'SELECT {PUBLIC_COLUMNS} FROM evaluation_jobs WHERE id=%s AND project_id=%s',
                 (job_id, project_id))
    if not row:
        raise HTTPException(404, 'Evaluation job not found')
    return row


@router.get('/evaluation-jobs', response_model=list[r.EvaluationJob], response_model_exclude_unset=True)
def jobs(project_id: UUID, user=Depends(identity)):
    authorize(project_id, user)
    return db.serial(db.all_rows(
        f'SELECT {PUBLIC_COLUMNS} FROM evaluation_jobs WHERE project_id=%s '
        'ORDER BY created_at DESC LIMIT 20', (project_id,)))


@router.post('/evaluation-jobs', status_code=202, response_model=r.EvaluationJob, response_model_exclude_unset=True)
def submit(project_id: UUID, body: EvaluationCreate, user=Depends(identity)):
    authorize(project_id, user)
    s = settings()
    if not body.custom and (s.app_env not in {'local', 'test'} or s.auth_mode != 'demo'):
        raise HTTPException(409, 'The built-in fixture benchmark runs in local demo instances')
    prior = db.one(
        f'SELECT {PUBLIC_COLUMNS} FROM evaluation_jobs '
        'WHERE project_id=%s AND user_id=%s AND idempotency_key=%s',
        (project_id, user, body.idempotency_key))
    if prior:
        if prior['request']['split'] != body.split or prior['request'].get('input') != evaluation_input(body.custom):
            raise HTTPException(409, 'Idempotency key belongs to a different evaluation request')
        return db.serial(prior)
    request = {'split': body.split, **benchmark_versions()}
    target_collection = prepare_custom(body.custom, project_id, user, s, request)
    try:
        with db.connection() as conn:
            row = conn.execute(
                'INSERT INTO evaluation_jobs(id,project_id,user_id,collection_id,request,'
                'idempotency_key) VALUES(%s,%s,%s,%s,%s,%s) '
                'ON CONFLICT(project_id,user_id,idempotency_key) DO NOTHING '
                f'RETURNING {PUBLIC_COLUMNS}',
                (db.uid(), project_id, user, target_collection, db.jsonb(request), body.idempotency_key)
            ).fetchone()
            if not row:
                row = conn.execute(
                    f'SELECT {PUBLIC_COLUMNS} FROM evaluation_jobs '
                    'WHERE project_id=%s AND user_id=%s AND idempotency_key=%s',
                    (project_id, user, body.idempotency_key)).fetchone()
                if row['request']['split'] != body.split or row['request'].get('input') != request.get('input'):
                    raise HTTPException(409, 'Idempotency key belongs to another evaluation')
    except psycopg.errors.UniqueViolation as exc:
        raise HTTPException(409, 'This project already has an active evaluation') from exc
    return db.serial(row)


@router.get('/evaluation-jobs/{job_id}', response_model=r.EvaluationJob, response_model_exclude_unset=True)
def detail(project_id: UUID, job_id: UUID, user=Depends(identity)):
    return db.serial(get_job(project_id, job_id, user))


@router.post('/evaluation-jobs/{job_id}/cancel', response_model=r.StatusResponse, response_model_exclude_unset=True)
def cancel(project_id: UUID, job_id: UUID, user=Depends(identity)):
    job = get_job(project_id, job_id, user)
    if job['status'] in {'completed', 'failed', 'cancelled'}:
        return {'status': job['status']}
    with db.connection() as conn:
        row = conn.execute(
            "UPDATE evaluation_jobs SET cancel_requested=true,status=CASE WHEN status='queued' "
            "THEN 'cancelled' ELSE status END,updated_at=now() "
            "WHERE id=%s AND project_id=%s AND status IN ('queued','running') RETURNING status",
            (job_id, project_id)).fetchone()
        if row:
            conn.execute(
                "UPDATE research_runs SET cancel_requested=true,status=CASE WHEN status IN "
                "('queued','retrying','awaiting_approval') THEN 'cancelled' ELSE status END,"
                "updated_at=now() WHERE evaluation_job_id=%s AND project_id=%s "
                "AND status NOT IN ('completed','failed','partial','cancelled')",
                (job_id, project_id))
    return {'status': 'cancellation_requested' if row else job['status']}


@router.get('/evaluation-jobs/{job_id}/judgments', response_model=list[r.SemanticGrade], response_model_exclude_unset=True)
def judgments(project_id: UUID, job_id: UUID, user=Depends(identity)):
    get_job(project_id, job_id, user)
    from .judging import public_rows
    return public_rows(job_id, project_id)
