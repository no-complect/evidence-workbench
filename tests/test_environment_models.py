"""Environment-only discovery and queued execution with synthetic provider responses."""
from types import SimpleNamespace
import pytest
from workbench import db, environment_models, graph, runs, retrieval, worker
from workbench.config import DEMO_PROJECT, settings
from workbench.providers import DemoProvider

pytestmark = pytest.mark.integration
SECRET = 'synthetic-environment-key-only'


def test_environment_catalog_is_scoped_secret_safe_and_independent_of_live_inference(client, monkeypatch):
    endpoint = f'/api/projects/{DEMO_PROJECT}/harness/models'
    profile = settings().model_copy(update={'openai_api_key': '', 'live_enabled': False})
    monkeypatch.setattr(environment_models, 'settings', lambda: profile)
    assert client.get(endpoint).json()['configured'] is False
    assert client.get(f'/api/projects/{db.uid()}/harness/models').status_code == 404
    profile.openai_api_key = SECRET
    observed = []

    class Client:
        def __init__(self, **kwargs):
            assert kwargs['follow_redirects'] is False and kwargs['trust_env'] is False
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def get(self, url, headers):
            observed.append((url, headers))
            return SimpleNamespace(raise_for_status=lambda: None, headers={'x-request-id': 'req_environment_test'},
                                   json=lambda: {'data': [{'id': 'any-family-model'}, {'id': 'embedding-model'}]})
    monkeypatch.setattr(environment_models.httpx, 'Client', Client)
    response = client.get(endpoint)
    assert response.status_code == 200
    assert response.json()['models'] == ['any-family-model', 'embedding-model']
    assert response.json()['live_enabled'] is False
    assert response.json()['request_id'] == 'req_environment_test'
    assert SECRET not in response.text
    assert observed == [(environment_models.ENDPOINT, {'Authorization': 'Bearer ' + SECRET})]
    # Environment-based discovery has no local/demo restriction; authorization still applies.
    profile.app_env, profile.auth_mode = 'production', 'supabase'
    assert client.get(endpoint).status_code == 200
    def broken(*args, **kwargs): raise RuntimeError(SECRET)
    monkeypatch.setattr(environment_models.httpx, 'Client', broken)
    failed = client.get(endpoint)
    assert failed.status_code == 502 and SECRET not in failed.text


def test_environment_selection_executes_pinned_model_without_connections_probes_or_prices(client, monkeypatch):
    project = client.post('/api/projects', json={'name': 'Environment model test'}).json()['id']
    profile = settings().model_copy(update={'openai_api_key': SECRET, 'live_enabled': True,
        'model_input_usd_per_million': None, 'model_output_usd_per_million': None,
        'embedding_usd_per_million': None})
    for module in [environment_models, runs, graph]:
        monkeypatch.setattr(module, 'settings', lambda: profile)
    monkeypatch.setattr(environment_models, 'catalog', lambda *args: {'models': ['new-chat-family', 'writer-family']})
    collection = db.uid()
    db.execute("INSERT INTO collections(id,project_id,name,embedding_config) VALUES(%s,%s,'Live environment','openai-small-v1')", (collection, project))
    calls = []

    class Provider:
        name = 'openai'
        def __init__(self, target=None, api_key=None):
            self.target = target
            if target:
                assert api_key == SECRET
        def invoke(self, stage, payload, schema, timeout=35):
            calls.append((stage, self.target['model_id']))
            return DemoProvider().invoke(stage, payload, schema)[0], 100, None
    monkeypatch.setattr(graph, 'OpenAIProvider', Provider)
    monkeypatch.setattr(retrieval, 'query_vector', lambda *args: [0.1] * 1536)
    body = {'collection_id': collection, 'question': 'Investigate synthetic security evidence.',
            'mode': 'live', 'model_id': 'new-chat-family', 'strategy': 'workflow',
            'approve_plan': False, 'idempotency_key': db.uid(),
            'harness_config': {'system_instruction': 'Retain the evidence gap.', 'context_policy': 'strict', 'stage_models': {'report': 'writer-family'}}}
    response = client.post(f'/api/projects/{project}/runs', json=body)
    assert response.status_code == 202, response.text
    rid = response.json()['id']
    queued = db.scoped_run(rid, project)
    pinned = queued['harness_snapshot']
    assert pinned['credential_source'] == 'environment'
    assert pinned['cost_estimates_available'] is False
    assert pinned['targets']['plan']['model_id'] == 'new-chat-family'
    assert pinned['targets']['report']['model_id'] == 'writer-family'
    assert pinned['configuration']['context_policy'] == 'strict'
    assert SECRET not in str(pinned) and calls == []
    assert db.one('SELECT count(*) AS n FROM provider_connections WHERE project_id=%s', (project,))['n'] == 0
    # A default change after enqueue must not switch the queued model.
    profile.openai_model = 'different-server-default'
    for _ in range(50):
        leased = worker.lease('environment-model-test')
        assert leased
        worker.execute_run(leased)
        if str(leased['id']) == rid:
            break
    row = db.scoped_run(rid, project)
    assert row['status'] == 'completed', row['error']
    assert calls == [('plan', 'new-chat-family'), ('assess', 'new-chat-family'), ('report', 'writer-family')]
    traces = db.all_rows('SELECT payload FROM contexts WHERE run_id=%s', (rid,))
    assert len(traces) == 3
    assert all(t['payload']['policy_version'].endswith('/strict') for t in traces)
    assert all('Retain the evidence gap.' in t['payload']['assembled_input']['trusted_instructions'] for t in traces)
    assert SECRET not in str(traces)
    # Idempotent replay uses the saved job even when the provider is unavailable.
    def unavailable(*args): raise RuntimeError('must not rediscover on replay')
    monkeypatch.setattr(environment_models, 'catalog', unavailable)
    assert client.post(f'/api/projects/{project}/runs', json=body).json()['id'] == rid
    monkeypatch.setattr(environment_models, 'catalog', lambda *args: {'models': []})
    stale = client.post(f'/api/projects/{project}/runs', json={**body, 'idempotency_key': db.uid()})
    assert stale.status_code == 409


def test_harness_studio_exposes_real_schemas_and_validates_without_model_calls(client):
    base = f'/api/projects/{DEMO_PROJECT}/harness'
    studio = client.get(base + '/studio')
    assert studio.status_code == 200
    assert studio.json()['schemas']['plan']['properties']['tasks']
    assert 'research planner' in studio.json()['prompts']['plan']
    good = client.post(base + '/validate-contract', json={'stage': 'report', 'payload': '{"title":"Test","summary":"Conditional","claims":[],"limitations":[]}'})
    assert good.json() == {'valid': True, 'errors': []}
    bad = client.post(base + '/validate-contract', json={'stage': 'report', 'payload': '{"unexpected":"private-marker"}'})
    assert bad.json()['valid'] is False and 'private-marker' not in bad.text
    assert client.get(f'/api/projects/{db.uid()}/harness/studio').status_code == 404
    assert client.post(f'/api/projects/{db.uid()}/harness/validate-contract', json={'stage':'plan','payload':'{}'}).status_code == 404
