from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import Field, ValidationError

from . import db, environment_models, harness, harness_presets
from . import responses as r
from .auth import authorize, identity
from .constants import ROOT
from .context import CAPS, POLICY, PROMPTS
from .models import (
    Assessment,
    ConnectionCreate,
    HarnessCreate,
    HarnessPreset,
    HarnessPresetCreate,
    ModelVerification,
    Plan,
    SemanticJudgment,
    StrictModel,
    SynthesisReport,
)

router = APIRouter(prefix='/api/projects/{project_id}/harness', tags=['harness'])


SCHEMAS = {'plan': Plan, 'assess': Assessment, 'report': SynthesisReport, 'judge': SemanticJudgment}


class ContractValidation(StrictModel):
    stage: Literal['plan', 'assess', 'report', 'judge']
    payload: str = Field(max_length=16000)


@router.get('/studio', response_model=r.HarnessStudioState, response_model_exclude_unset=True)
def studio(project_id: UUID, user=Depends(identity)):
    authorize(project_id, user)
    return {
        'schemas': {key: model.model_json_schema() for key, model in SCHEMAS.items()},
        'prompts': {key: (ROOT / 'prompts' / f'{PROMPTS[key]}.md').read_text() for key in SCHEMAS},
        'context_policy': POLICY,
        'context_caps': CAPS,
    }


@router.post(
    '/validate-contract',
    response_model=r.ContractValidationResult,
    response_model_exclude_unset=True,
)
def validate_contract(project_id: UUID, body: ContractValidation, user=Depends(identity)):
    authorize(project_id, user)
    try:
        SCHEMAS[body.stage].model_validate_json(body.payload)
        return {'valid': True, 'errors': []}
    except ValidationError as exc:
        return {
            'valid': False,
            'errors': [
                {'path': '.'.join(map(str, error['loc'])), 'type': error['type']}
                for error in exc.errors(include_input=False, include_context=False)
            ],
        }


@router.get('/models', response_model=r.ModelCatalog, response_model_exclude_unset=True)
def models(project_id: UUID, user=Depends(identity)):
    return environment_models.catalog(project_id, user)


@router.get('/presets', response_model=list[HarnessPreset])
def presets(project_id: UUID, user=Depends(identity)):
    return harness_presets.list_presets(project_id, user)


@router.post('/presets', status_code=201, response_model=HarnessPreset)
def save_preset(project_id: UUID, body: HarnessPresetCreate, user=Depends(identity)):
    return harness_presets.save_preset(project_id, user, body)


@router.get('', response_model=r.HarnessState, response_model_exclude_unset=True)
def state(project_id: UUID, user=Depends(identity)):
    return db.serial(harness.list_state(project_id, user))


@router.post(
    '/connections',
    status_code=201,
    response_model=r.ProviderConnection,
    response_model_exclude_unset=True,
)
def connect(project_id: UUID, body: ConnectionCreate, user=Depends(identity)):
    return db.serial(harness.create_connection(project_id, user, body))


@router.post(
    '/connections/{connection_id}/discover',
    response_model=list[str],
    response_model_exclude_unset=True,
)
def discover(project_id: UUID, connection_id: UUID, user=Depends(identity)):
    return harness.discover(project_id, connection_id, user)


@router.post(
    '/connections/{connection_id}/disconnect',
    response_model=r.StatusResponse,
    response_model_exclude_unset=True,
)
def disconnect(project_id: UUID, connection_id: UUID, user=Depends(identity)):
    harness.disconnect(project_id, connection_id, user)
    return {'status': 'disconnected'}


@router.post(
    '/connections/{connection_id}/verify',
    response_model=r.ProviderCheck,
    response_model_exclude_unset=True,
)
def verify(project_id: UUID, connection_id: UUID, body: ModelVerification, user=Depends(identity)):
    return db.serial(harness.verify_model(project_id, connection_id, user, body))


@router.post(
    '/revisions',
    status_code=201,
    response_model=r.HarnessRevision,
    response_model_exclude_unset=True,
)
def revision(project_id: UUID, body: HarnessCreate, user=Depends(identity)):
    return db.serial(harness.save_revision(project_id, user, body))
