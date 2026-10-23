"""Reusable settings are scoped, immutable drafts, independent of paid providers."""
from concurrent.futures import ThreadPoolExecutor
from uuid import UUID
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from workbench import db, environment_models, harness_presets
from workbench.models import HarnessPresetCreate, HarnessPresetSettings, HarnessConfiguration, Limits


def body(**changes):
    return HarnessPresetCreate(name='Evidence baseline', idempotency_key=db.uid(),
        settings=HarnessPresetSettings(configuration=HarnessConfiguration(
            system_instruction='Cite the source; preserve gaps.', context_policy='strict'),
            limits=Limits(), model_id='saved-model', judge_model_id='saved-judge'), **changes)


def test_presets_reject_invalid_limits_and_extra_fields():
    for value in [-1, float('nan'), float('inf')]:
        with pytest.raises(ValidationError):
            Limits(estimated_cost_usd=value)
    with pytest.raises(ValidationError):
        HarnessPresetSettings(configuration=HarnessConfiguration(), limits=Limits(), api_key='not-allowed')
    with pytest.raises(ValidationError):
        HarnessPresetCreate(name='   ', settings=body().settings, idempotency_key=db.uid())


@pytest.mark.integration
def test_presets_are_authorized_immutable_idempotent_and_make_no_calls(client, monkeypatch):
    project = client.post('/api/projects', json={'name': 'Preset test'}).json()['id']
    endpoint = f'/api/projects/{project}/harness/presets'
    request = body().model_dump(mode='json')
    def no_calls(*args, **kwargs):
        raise AssertionError('Saving a draft must not discover or invoke a model')
    monkeypatch.setattr(environment_models, 'catalog', no_calls)
    assert client.get(endpoint).json() == []
    response = client.post(endpoint, json=request)
    assert response.status_code == 201, response.text
    saved = response.json()
    assert saved['settings'] == request['settings'] and len(saved['settings_hash']) == 64
    assert 'idempotency_key' not in saved and 'user_id' not in saved
    assert client.post(endpoint, json=request).json() == saved
    conflict = client.post(endpoint, json={**request, 'name': 'Changed name'})
    assert conflict.status_code == 409
    assert client.get(endpoint).json() == [saved]
    assert client.get(f'/api/projects/{db.uid()}/harness/presets').status_code == 404
    assert client.post(f'/api/projects/{db.uid()}/harness/presets', json=request).status_code == 404
    other_user = db.uid()
    db.execute("INSERT INTO project_memberships VALUES(%s,%s,'member')", (project, other_user))
    assert harness_presets.list_presets(project, other_user) == []
    # Same retry key in another user's namespace cannot expose or overwrite the first.
    second = harness_presets.save_preset(project, other_user, HarnessPresetCreate.model_validate(request))
    assert second['id'] != saved['id'] and second['settings_hash'] == saved['settings_hash']
    for statement in ["UPDATE harness_presets SET name='changed' WHERE id=%s",
                      'DELETE FROM harness_presets WHERE id=%s']:
        with pytest.raises(Exception, match='Harness presets are immutable'):
            db.execute(statement, (saved['id'],))
    assert db.one('SELECT count(*) AS n FROM research_runs WHERE project_id=%s', (project,))['n'] == 0
    assert db.one('SELECT count(*) AS n FROM provider_connections WHERE project_id=%s', (project,))['n'] == 0


@pytest.mark.integration
def test_concurrent_saves_share_one_record_and_cap_still_allows_retry(client, monkeypatch):
    from workbench.config import DEMO_USER
    project = client.post('/api/projects', json={'name': 'Preset concurrency'}).json()['id']
    request = body()
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: harness_presets.save_preset(project, DEMO_USER, request), range(2)))
    assert results[0] == results[1]
    monkeypatch.setattr(harness_presets, 'MAX_PRESETS', 1)
    assert harness_presets.save_preset(UUID(project), DEMO_USER, request) == results[0]
    with pytest.raises(HTTPException) as exc:
        harness_presets.save_preset(project, DEMO_USER, body())
    assert exc.value.status_code == 409
