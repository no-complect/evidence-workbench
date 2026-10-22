"""Local provider APIs and real queued runtime, with synthetic provider responses."""
import concurrent.futures
import sys
from types import SimpleNamespace
import pytest
from psycopg.errors import CheckViolation
from workbench import db, harness, credential_store
from workbench.config import DEMO_PROJECT, settings

pytestmark = pytest.mark.integration
BASE = f'/api/projects/{DEMO_PROJECT}/harness'
SECRET = 'synthetic-provider-credential-only'


@pytest.fixture
def provider(monkeypatch, tmp_path, client):
    from workbench import graph, runs, providers
    profile = settings().model_copy(update={'live_enabled': True, 'openai_api_key': SECRET,
                                            'credential_store_path': tmp_path, 'embedding_usd_per_million': 0.1})
    for module in [harness, graph, runs, credential_store]:
        monkeypatch.setattr(module, 'settings', lambda: profile)
    project = client.post("/api/projects", json={"name": "Provider test"}).json()["id"]
    monkeypatch.setattr(sys.modules[__name__], "BASE", f"/api/projects/{project}/harness")
    calls = []

    class FakeProvider:
        name = 'openai'
        def __init__(self, target=None, key=None):
            self.target = target
            if target is not None:
                assert key == SECRET
        def invoke(self, stage, payload, schema, timeout=35):
            calls.append((stage, self.target['model_id']))
            return providers.DemoProvider().invoke(stage, payload, schema)[0], 100, 0.0001
    monkeypatch.setattr(harness, 'OpenAIProvider', FakeProvider)
    monkeypatch.setattr(graph, 'OpenAIProvider', FakeProvider)
    return calls


def connect(client):
    response = client.post(BASE + '/connections', json={'name': 'Test account', 'api_key': SECRET})
    assert response.status_code == 201, response.text
    assert SECRET not in response.text and 'encrypted_key' not in response.text
    cid = response.json()['id']
    db.execute('UPDATE provider_connections SET catalog=%s WHERE id=%s', (db.jsonb(['account-model-a', 'account-model-b']), cid))
    return cid


def verified(client, cid, model='account-model-a'):
    body = {'model_id': model, 'input_usd_per_million': 1, 'output_usd_per_million': 3,
            'max_cost_usd': 0.1, 'idempotency_key': db.uid()}
    response = client.post(BASE + f'/connections/{cid}/verify', json=body)
    assert response.status_code == 200, response.text
    assert response.json()['status'] == 'verified'
    return response.json(), body


def revision(client, checks):
    body = {'name': 'Pinned research', 'targets': dict(zip(['plan', 'assess', 'report'], checks, strict=True)),
            'limits': {'tokens': 48000, 'estimated_cost_usd': 0.5}, 'idempotency_key': db.uid()}
    response = client.post(BASE + '/revisions', json=body)
    assert response.status_code == 201, response.text
    return response.json(), body


def test_catalog_scope_secrets_and_revocation(client, provider, monkeypatch):
    cid = connect(client)
    assert db.one('SELECT encrypted_key FROM provider_connections WHERE id=%s', (cid,))['encrypted_key'] != SECRET
    observed = []

    class Client:
        def __init__(self, **kwargs):
            assert kwargs['follow_redirects'] is False and kwargs['trust_env'] is False
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def get(self, url, headers):
            observed.append(url)
            assert headers['Authorization'] == 'Bearer ' + SECRET
            return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {'data': [
                {'id': 'account-model-a'}, {'id': 'embedding-model'}, {'id': 'bad\nmodel'}]})
    monkeypatch.setattr(harness.httpx, 'Client', Client)
    response = client.post(BASE + f'/connections/{cid}/discover')
    assert response.json() == ['account-model-a', 'embedding-model']
    state = client.get(BASE).json()
    assert state['checks'] == [] and observed == ['https://api.openai.com/v1/models']
    assert SECRET not in str(state) and 'encrypted_key' not in str(state)
    assert client.get(f'/api/projects/{db.uid()}/harness').status_code == 404
    marker = 'private-short'
    invalid = client.post(BASE + '/connections', json={'name': 'No leak', 'api_key': marker})
    assert invalid.status_code == 422 and marker not in invalid.text
    monkeypatch.setattr(harness, 'settings', lambda: SimpleNamespace(app_env='production', auth_mode='supabase'))
    assert client.get(BASE).status_code == 403
    monkeypatch.undo()


def test_verification_budget_idempotency_and_uncertain_calls(client, provider, monkeypatch):
    cid = connect(client)
    check, body = verified(client, cid)
    assert len(provider) == 3
    repeated = client.post(BASE + f'/connections/{cid}/verify', json=body)
    assert repeated.json()['id'] == check['id'] and len(provider) == 3
    assert client.post(BASE + f'/connections/{cid}/verify', json={**body, 'model_id': 'account-model-b'}).status_code == 409
    assert client.post(BASE + f'/connections/{cid}/verify', json={**body, 'idempotency_key': db.uid(), 'max_cost_usd': 0.000001}).status_code == 409
    assert client.post(BASE + f'/connections/{cid}/verify', json={**body, 'idempotency_key': db.uid(), 'model_id': 'not-listed'}).status_code == 409
    class TimeoutProvider:
        def __init__(self, *args): pass
        def invoke(self, *args, **kwargs): raise TimeoutError(SECRET)
    monkeypatch.setattr(harness, 'OpenAIProvider', TimeoutProvider)
    uncertain_body = {**body, 'idempotency_key': db.uid()}
    uncertain = client.post(BASE + f'/connections/{cid}/verify', json=uncertain_body)
    assert uncertain.json()['status'] == 'uncertain' and SECRET not in uncertain.text
    again = client.post(BASE + f'/connections/{cid}/verify', json=uncertain_body)
    assert again.json()['id'] == uncertain.json()['id']
    bad_revision = client.post(BASE + '/revisions', json={'name': 'Not verified', 'targets': dict.fromkeys(['plan','assess','report'], uncertain.json()['id']), 'idempotency_key': db.uid()})
    assert bad_revision.status_code == 409


def test_concurrent_checks_are_single_owner_and_revisions_immutable(client, provider):
    cid = connect(client)
    body = {'model_id': 'account-model-a', 'input_usd_per_million': 1, 'output_usd_per_million': 3,
            'max_cost_usd': 0.1, 'idempotency_key': db.uid()}
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: client.post(BASE + f'/connections/{cid}/verify', json=body), range(2)))
    assert all(r.status_code == 200 for r in results) and len(provider) == 3
    assert results[0].json()['id'] == results[1].json()['id']
    vid = results[0].json()['id']
    saved, request = revision(client, [vid]*3)
    assert client.post(BASE + '/revisions', json=request).json()['id'] == saved['id']
    assert client.post(BASE + '/revisions', json={**request, 'name': 'changed'}).status_code == 409
    with pytest.raises(CheckViolation):
        db.execute("UPDATE harness_revisions SET name='changed' WHERE id=%s", (saved['id'],))
    assert client.post(BASE + f'/connections/{cid}/disconnect').status_code == 200
    assert db.one('SELECT encrypted_key FROM provider_connections WHERE id=%s', (cid,))['encrypted_key'] is None
    assert client.post(BASE + '/revisions', json={**request, 'idempotency_key': db.uid()}).status_code == 409


def test_queued_live_run_uses_immutable_stage_models_prices_and_traces(client, provider, monkeypatch):
    from workbench import retrieval, worker
    project = BASE.split('/')[3]
    cid = connect(client)
    a, _ = verified(client, cid, 'account-model-a')
    b, _ = verified(client, cid, 'account-model-b')
    saved, _ = revision(client, [a['id'], a['id'], b['id']])
    # No external embeddings or chat calls; queue, budgets, graph and persistence are real.
    monkeypatch.setattr(retrieval, 'query_vector', lambda *args: [0.1] * 1536)
    collection = db.uid()
    db.execute("INSERT INTO collections(id,project_id,name,embedding_config) VALUES(%s,%s,'Live test','openai-small-v1')", (collection, project))
    response = client.post(f'/api/projects/{project}/runs', json={
        'collection_id': collection, 'question': 'Investigate synthetic security evidence.', 'mode': 'live',
        'strategy': 'workflow', 'approve_plan': False, 'harness_revision_id': saved['id'],
        'limits': {'tokens': 500}, 'idempotency_key': db.uid()})
    assert response.status_code == 202, response.text
    rid = response.json()['id']
    row = db.scoped_run(rid, project)
    assert row['request']['limits']['tokens'] == 48000 and row['harness_snapshot']['revision_id'] == saved['id']
    assert row['harness_snapshot']['embedding_usd_per_million'] == 0.1
    with pytest.raises(CheckViolation):
        db.execute('UPDATE research_runs SET harness_snapshot=%s WHERE id=%s', (db.jsonb({}),rid))
    for _ in range(50):
        leased = worker.lease('harness-test')
        assert leased
        worker.execute_run(leased)
        if str(leased['id']) == rid:
            break
    row = db.scoped_run(rid, project)
    assert row['status'] == 'completed', row['error']
    assert provider[-3:] == [('plan', 'account-model-a'), ('assess', 'account-model-a'), ('report', 'account-model-b')]
    traces = db.all_rows('SELECT payload FROM contexts WHERE run_id=%s', (rid,))
    assert len(traces) == 3 and all(t['payload']['harness_revision_id'] == saved['id'] for t in traces)
    assert SECRET not in str(traces)
    assert all(t['payload']['model_target']['input_usd_per_million'] == 1 for t in traces)

    # Revocation after enqueue must stop the worker before another inference call.
    queued = client.post(f'/api/projects/{project}/runs', json={
        'collection_id': collection, 'question': 'Investigate synthetic security evidence.', 'mode': 'live',
        'strategy': 'workflow', 'approve_plan': False, 'harness_revision_id': saved['id'],
        'idempotency_key': db.uid()})
    assert queued.status_code == 202
    before = len(provider)
    client.post(BASE + f'/connections/{cid}/disconnect')
    leased = worker.lease('revoked-harness')
    assert str(leased['id']) == queued.json()['id']
    worker.execute_run(leased)
    assert db.scoped_run(queued.json()['id'], project)['status'] == 'failed'
    assert len(provider) == before
