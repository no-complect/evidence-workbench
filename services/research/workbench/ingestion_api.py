from uuid import UUID
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from . import db, ingestion_jobs as jobs
from .auth import authorize, identity
from .ingest import IngestionConflict, IngestionError, MAX_BYTES

router = APIRouter(prefix='/api/projects/{project_id}')


@router.get('/ingestions')
def list_jobs(project_id: UUID, user=Depends(identity)):
    authorize(project_id, user)
    # Keep every active job and the latest 40 terminal records, without internal keys.
    return db.serial(db.all_rows(
        f'SELECT {jobs.PUBLIC_COLUMNS} FROM ingestion_jobs WHERE project_id=%s AND '
        "(status IN ('queued','running') OR id IN (SELECT id FROM ingestion_jobs WHERE project_id=%s "
        "AND status NOT IN ('queued','running') ORDER BY created_at DESC,id DESC LIMIT 40)) ORDER BY created_at,id",
        (project_id, project_id)))


@router.post('/collections/{collection_id}/ingestions', status_code=202)
def stage(project_id: UUID, collection_id: UUID, file: UploadFile = File(...),
          idempotency_key: UUID = Form(...), user=Depends(identity)):
    # Authorize before reading/storing bytes; parsing and models are worker-only.
    try:
        jobs.collection(project_id, collection_id, user)
        return db.serial(jobs.enqueue(project_id, collection_id, user, idempotency_key,
                                      file.filename or 'upload.txt', file.file.read(MAX_BYTES + 1)))
    except jobs.NotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    except IngestionConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except IngestionError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get('/ingestions/{job_id}')
def get_job(project_id: UUID, job_id: UUID, user=Depends(identity)):
    authorize(project_id, user)
    job = jobs.public(job_id, project_id)
    if not job:
        raise HTTPException(404, 'File preparation not found')
    return db.serial(job)


@router.post('/ingestions/{job_id}/retry', status_code=202)
def retry(project_id: UUID, job_id: UUID, user=Depends(identity)):
    try:
        return db.serial(jobs.retry(project_id, job_id, user))
    except IngestionConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except IngestionError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post('/ingestions/{job_id}/cancel')
def cancel(project_id: UUID, job_id: UUID, user=Depends(identity)):
    authorize(project_id, user)
    if not jobs.public(job_id, project_id):
        raise HTTPException(404, 'File preparation not found')
    db.execute("UPDATE ingestion_jobs SET cancel_requested=true,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,"
               "phase=CASE WHEN status='queued' THEN 'finished' ELSE phase END,updated_at=now() "
               "WHERE id=%s AND project_id=%s AND status IN ('queued','running')", (job_id, project_id))
    return db.serial(jobs.public(job_id, project_id))
