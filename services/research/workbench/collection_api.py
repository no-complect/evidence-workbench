"""Collection creation and resumable preparation."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from . import db
from . import responses as r
from .auth import authorize, identity
from .collection_setup import SetupConflict
from .collection_setup import options as collection_options
from .collection_setup import prepare as prepare_collection
from .collection_setup import resume as resume_collection
from .config import settings
from .models import CollectionCreate, CollectionSetup

router = APIRouter(prefix='/api/projects/{project_id}', tags=['collections'])


@router.post(
    '/collections',
    status_code=201,
    response_model=r.CreatedCollection,
    response_model_exclude_unset=True,
)
def create_collection(project_id: UUID, body: CollectionCreate, user=Depends(identity)):
    authorize(project_id, user)
    if body.embedding_config == 'openai-small-v1' and not settings().live_enabled:
        raise HTTPException(409, 'Enable live mode before creating a live embedding collection')
    cid = db.uid()
    db.execute(
        'INSERT INTO collections(id,project_id,name,embedding_config) VALUES(%s,%s,%s,%s)',
        (cid, project_id, body.name, body.embedding_config),
    )
    return {'id': cid, 'name': body.name, 'embedding_config': body.embedding_config}


@router.get(
    '/collection-options', response_model=r.CollectionOptions, response_model_exclude_unset=True
)
def setup_options(project_id: UUID, user=Depends(identity)):
    authorize(project_id, user)
    return collection_options()


@router.post(
    '/collection-setups',
    status_code=201,
    response_model=r.Collection,
    response_model_exclude_unset=True,
)
def setup_collection(project_id: UUID, body: CollectionSetup, user=Depends(identity)):
    try:
        return db.serial(prepare_collection(project_id, user, body))
    except SetupConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post(
    '/collections/{collection_id}/prepare',
    response_model=r.Collection,
    response_model_exclude_unset=True,
)
def retry_collection_preparation(project_id: UUID, collection_id: UUID, user=Depends(identity)):
    try:
        return db.serial(resume_collection(project_id, str(collection_id), user))
    except SetupConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
