from uuid import UUID
from fastapi import APIRouter, Depends
from . import db, harness, environment_models
from .auth import identity
from .models import ConnectionCreate, ModelVerification, HarnessCreate

router = APIRouter(prefix='/api/projects/{project_id}/harness', tags=['harness'])


@router.get('/models')
def models(project_id: UUID, user=Depends(identity)):
    return environment_models.catalog(project_id, user)


@router.get('')
def state(project_id: UUID, user=Depends(identity)):
    return db.serial(harness.list_state(project_id, user))


@router.post('/connections', status_code=201)
def connect(project_id: UUID, body: ConnectionCreate, user=Depends(identity)):
    return db.serial(harness.create_connection(project_id, user, body))


@router.post('/connections/{connection_id}/discover')
def discover(project_id: UUID, connection_id: UUID, user=Depends(identity)):
    return harness.discover(project_id, connection_id, user)


@router.post('/connections/{connection_id}/disconnect')
def disconnect(project_id: UUID, connection_id: UUID, user=Depends(identity)):
    harness.disconnect(project_id, connection_id, user)
    return {'status': 'disconnected'}


@router.post('/connections/{connection_id}/verify')
def verify(project_id: UUID, connection_id: UUID, body: ModelVerification, user=Depends(identity)):
    return db.serial(harness.verify_model(project_id, connection_id, user, body))


@router.post('/revisions', status_code=201)
def revision(project_id: UUID, body: HarnessCreate, user=Depends(identity)):
    return db.serial(harness.save_revision(project_id, user, body))
