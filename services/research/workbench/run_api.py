"""Research submission, approval and saved run inspection."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from . import db
from . import responses as r
from .auth import authorize, identity
from .evidence import for_run, markdown
from .models import Plan, RunCreate, RunSummary
from .runs import create_run as submit_run

router = APIRouter(prefix='/api/projects/{project_id}', tags=['runs'])


def get_run(project_id, run_id, user):
    authorize(project_id, user)
    run = db.one('SELECT * FROM research_runs WHERE id=%s AND project_id=%s', (run_id, project_id))
    if not run:
        raise HTTPException(404, 'Run not found')
    return run


@router.post('/runs', status_code=202, response_model=RunSummary)
def create_run(project_id: UUID, body: RunCreate, user=Depends(identity)):
    return submit_run(project_id, body, user)


@router.get('/runs/{run_id}', response_model=r.Detail, response_model_exclude_unset=True)
def run_detail(project_id: UUID, run_id: UUID, user=Depends(identity)):
    run = get_run(project_id, run_id, user)
    run.pop('lease_owner', None)
    return db.serial(
        {
            'run': run,
            'evidence': for_run(run),
            'contexts': db.all_rows(
                'SELECT * FROM contexts WHERE run_id=%s AND project_id=%s ORDER BY created_at',
                (run_id, project_id),
            ),
            'tasks': db.all_rows(
                'SELECT * FROM research_tasks WHERE run_id=%s AND project_id=%s ORDER BY iteration,id',
                (run_id, project_id),
            ),
        }
    )


@router.get('/runs/{run_id}/events', response_model=r.EventPage, response_model_exclude_unset=True)
def events(project_id: UUID, run_id: UUID, after: int = Query(0, ge=0), user=Depends(identity)):
    get_run(project_id, run_id, user)
    rows = db.all_rows(
        'SELECT * FROM run_events WHERE run_id=%s AND project_id=%s AND id>%s ORDER BY id LIMIT 200',
        (run_id, project_id, after),
    )
    return db.serial({'events': rows, 'cursor': rows[-1]['id'] if rows else after})


@router.post(
    '/runs/{run_id}/approve',
    status_code=202,
    response_model=r.StatusResponse,
    response_model_exclude_unset=True,
)
def approve(project_id: UUID, run_id: UUID, body: Plan, user=Depends(identity)):
    run = get_run(project_id, run_id, user)
    if len({t.id for t in body.tasks}) != len(body.tasks):
        raise HTTPException(422, 'Task IDs must be unique')
    if run['mode'] == 'demo' and any(
        t.topic not in {'security', 'cost', 'retrieval', 'maintenance', 'unknown', 'retention'}
        for t in body.tasks
    ):
        raise HTTPException(422, 'Demo plan topics must use the supported fixture topics')
    count = db.execute(
        "UPDATE research_runs SET status='queued',plan=%s,approved_plan=%s,deadline=now()+(%s * interval '1 second'),attempts=0,available_at=now() WHERE id=%s AND project_id=%s AND status='awaiting_approval' AND NOT cancel_requested",
        (
            db.jsonb(body.model_dump()),
            db.jsonb(body.model_dump()),
            run['request']['limits']['wall_seconds'],
            run_id,
            project_id,
        ),
    )
    if not count:
        raise HTTPException(409, 'Run is not waiting for approval')
    return {'status': 'queued'}


@router.post(
    '/runs/{run_id}/cancel', response_model=r.StatusResponse, response_model_exclude_unset=True
)
def cancel(project_id: UUID, run_id: UUID, user=Depends(identity)):
    run = get_run(project_id, run_id, user)
    if run['status'] in {'completed', 'failed', 'partial', 'cancelled'}:
        return {'status': run['status']}
    db.execute(
        "UPDATE research_runs SET cancel_requested=true,status=CASE WHEN status IN ('queued','retrying','awaiting_approval') THEN 'cancelled' ELSE status END,updated_at=now() WHERE id=%s AND project_id=%s",
        (run_id, project_id),
    )
    db.event(run, 'cancel-request', 'cancel', 'Cancellation requested')
    return {'status': 'cancellation_requested'}


@router.get(
    '/runs/{run_id}/report.md',
    response_class=Response,
    responses={200: {'content': {'text/markdown': {'schema': {'type': 'string'}}}}},
)
def export(project_id: UUID, run_id: UUID, user=Depends(identity)):
    run = get_run(project_id, run_id, user)
    if not run['report']:
        raise HTTPException(409, 'Report is not ready')
    return Response(
        markdown(run),
        media_type='text/markdown',
        headers={'Content-Disposition': 'attachment; filename="research-report.md"'},
    )
