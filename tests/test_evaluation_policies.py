from unittest.mock import patch
from uuid import uuid4
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from workbench.api import app
from workbench.config import Settings
from workbench.evaluation_api import EvaluationCreate, submit
from workbench.evaluation_worker import guard, EvaluationStopped, EvaluationLeaseLost


def test_evaluation_is_not_an_unauthenticated_execution_endpoint():
    with TestClient(app) as client:
        response = client.post(f'/api/projects/{uuid4()}/evaluation-jobs', json={
            'idempotency_key': str(uuid4()), 'split': 'development'})
    assert response.status_code == 401


def test_fixture_jobs_reject_hosted_authenticated_configuration():
    with patch('workbench.evaluation_api.authorize'), patch(
        'workbench.evaluation_api.settings',
        return_value=Settings(_env_file=None, app_env='test', auth_mode='supabase')
    ):
        with pytest.raises(HTTPException) as exc:
            submit(uuid4(), EvaluationCreate(idempotency_key=str(uuid4())), uuid4())
    assert exc.value.status_code == 409


def test_only_supported_case_splits_are_accepted():
    with pytest.raises(ValidationError):
        EvaluationCreate(split='live', idempotency_key=str(uuid4()))
    with pytest.raises(ValidationError):
        EvaluationCreate(idempotency_key='short')


@pytest.mark.parametrize('row,error', [
    (None, EvaluationLeaseLost),
    ({'leased': False, 'cancel_requested': False}, EvaluationLeaseLost),
    ({'leased': True, 'cancel_requested': True}, EvaluationStopped),
])
def test_expired_ownership_and_cancellation_prevent_execution(row, error):
    with patch('workbench.evaluation_worker.db.one', return_value=row):
        with pytest.raises(error):
            guard({'id': str(uuid4()), 'lease_owner': 'evaluation-policy-test'})
