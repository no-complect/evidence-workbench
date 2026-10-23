from uuid import UUID
from fastapi import APIRouter, Depends
from . import db, harness, environment_models, harness_presets
from .models import HarnessPresetCreate, HarnessPreset
from .auth import identity
from .models import ConnectionCreate, ModelVerification, HarnessCreate, StrictModel, Plan, Assessment, Report, SemanticJudgment
from .auth import authorize
from .context import CAPS, POLICY
from .constants import ROOT
from pydantic import Field, ValidationError
from typing import Literal

router = APIRouter(prefix='/api/projects/{project_id}/harness', tags=['harness'])


SCHEMAS = {'plan': Plan, 'assess': Assessment, 'report': Report, 'judge': SemanticJudgment}


class ContractValidation(StrictModel):
    stage: Literal['plan', 'assess', 'report', 'judge']
    payload: str = Field(max_length=16000)


@router.get('/studio')
def studio(project_id: UUID, user=Depends(identity)):
    authorize(project_id, user)
    return {'schemas': {key: model.model_json_schema() for key, model in SCHEMAS.items()},
            'prompts': {key: (ROOT / 'prompts' / f'{key}-v1.md').read_text() for key in SCHEMAS},
            'context_policy': POLICY, 'context_caps': CAPS}


@router.post('/validate-contract')
def validate_contract(project_id: UUID, body: ContractValidation, user=Depends(identity)):
    authorize(project_id, user)
    try:
        SCHEMAS[body.stage].model_validate_json(body.payload)
        return {'valid': True, 'errors': []}
    except ValidationError as exc:
        return {'valid': False, 'errors': [{'path': '.'.join(map(str, error['loc'])),
                'type': error['type']} for error in exc.errors(include_input=False, include_context=False)]}


@router.get('/models')
def models(project_id: UUID, user=Depends(identity)):
    return environment_models.catalog(project_id, user)


@router.get('/presets', response_model=list[HarnessPreset])
def presets(project_id: UUID, user=Depends(identity)):
    return harness_presets.list_presets(project_id, user)


@router.post('/presets', status_code=201, response_model=HarnessPreset)
def save_preset(project_id: UUID, body: HarnessPresetCreate, user=Depends(identity)):
    return harness_presets.save_preset(project_id, user, body)


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
