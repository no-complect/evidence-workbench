"""Real LangChain/OpenAI transport responses and SQL; no external provider calls."""

import json
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest
from psycopg.errors import CheckViolation
from workbench import collection_api, db, ingest, ingestion_jobs, project_api
from workbench import ingestion_worker as worker
from workbench.config import settings
from workbench.embedding_usage import AccountingError, RecordingClient, reported_tokens, request_id


@pytest.mark.parametrize('value', [None, -1, True, 1.5, '12'])
def test_unreported_usage_is_never_coerced_to_zero(value):
    assert reported_tokens({'usage': {'total_tokens': value}}) is None


def test_actual_zero_and_safe_request_provenance_are_distinct_from_missing():
    assert reported_tokens(SimpleNamespace(usage=SimpleNamespace(total_tokens=0))) == 0
    assert reported_tokens({'usage': {'total_tokens': 17}}) == 17
    assert reported_tokens({}) is None
    assert request_id(SimpleNamespace(_request_id='req_synthetic_1')) == 'req_synthetic_1'
    assert request_id(SimpleNamespace(request_id='req_synthetic_2')) == 'req_synthetic_2'
    assert request_id(SimpleNamespace(_request_id='synthetic-private-credential')) is None
    assert request_id(SimpleNamespace(_request_id='req_' + 'x' * 130)) is None


def test_accounting_failure_prevents_provider_invocation_and_never_retries():
    transport = Mock()
    recorder = Mock()
    recorder.reserve.side_effect = AccountingError('Accounting unavailable')
    with pytest.raises(AccountingError):
        RecordingClient(transport, recorder).create(input=['Synthetic source'])
    transport.create.assert_not_called()


@pytest.fixture
def scenario(client, monkeypatch):
    import langchain_openai

    base_settings = settings()
    state = {'rate': 0.02, 'behavior': 'reported', 'calls': [], 'after_response': None}

    def profile():
        return base_settings.model_copy(
            update={
                'live_enabled': True,
                'openai_api_key': 'synthetic-not-a-real-key',
                'embedding_usd_per_million': state['rate'],
            }
        )

    for module in [collection_api, project_api, ingest, ingestion_jobs]:
        monkeypatch.setattr(module, 'settings', profile)
    original = langchain_openai.OpenAIEmbeddings

    def response(request):
        body = json.loads(request.content)
        state['calls'].append(body)
        headers = {'x-request-id': f'req_synthetic_{len(state["calls"])}'}
        if state['behavior'] == 'error':
            return httpx.Response(
                429,
                headers=headers,
                json={
                    'error': {
                        'code': 'insufficient_quota',
                        'message': 'synthetic-private-response-body',
                        'type': 'insufficient_quota',
                    }
                },
            )
        payload = {
            'object': 'list',
            'model': body['model'],
            'data': [
                {'object': 'embedding', 'index': i, 'embedding': [0.1] * 1536}
                for i, _ in enumerate(body['input'])
            ],
        }
        if state['behavior'] != 'missing':
            payload['usage'] = {
                'prompt_tokens': 7 * len(body['input']),
                'total_tokens': 7 * len(body['input']),
            }
        if state['after_response']:
            state['after_response']()
        return httpx.Response(200, headers=headers, json=payload)

    def adapter(**kwargs):
        kwargs['http_client'] = httpx.Client(
            transport=httpx.MockTransport(response), trust_env=False
        )
        kwargs['openai_api_base'] = 'https://api.openai.com/v1'
        return original(**kwargs)

    monkeypatch.setattr(langchain_openai, 'OpenAIEmbeddings', adapter)
    pid = client.post('/api/projects', json={'name': 'Embedding accounting'}).json()['id']
    base = f'/api/projects/{pid}'
    cid = client.post(
        base + '/collections', json={'name': 'Live index', 'embedding_config': 'openai-small-v1'}
    ).json()['id']
    state.update(pid=pid, cid=cid, base=base, path=base + f'/collections/{cid}')
    yield state
    db.execute(
        "UPDATE ingestion_jobs SET status='cancelled',phase='finished' WHERE project_id=%s AND status IN ('queued','running')",
        (pid,),
    )


def submit(client, scope, data, key=None):
    result = client.post(
        scope['path'] + '/ingestions',
        data={'idempotency_key': key or db.uid()},
        files={'file': ('policy.txt', data, 'text/plain')},
    )
    assert result.status_code == 202, result.text
    return result.json()['id']


def execute(scope, jid):
    job = worker.lease(db.uid())
    assert str(job['id']) == jid
    worker.execute(job)
    return db.one('SELECT * FROM ingestion_jobs WHERE id=%s AND project_id=%s', (jid, scope['pid']))


@pytest.mark.integration
def test_real_transport_batches_are_recorded_and_submission_rate_is_pinned(client, scenario):
    s = scenario
    data = '\n\n'.join(
        f'Synthetic private passage {i} requires archival review.' for i in range(65)
    ).encode()
    jid = submit(client, s, data)
    s['rate'] = 9
    assert execute(s, jid)['status'] == 'ready'
    result = client.get(s['path'] + '/embedding-usage')
    assert result.status_code == 200
    summary = result.json()['summary']
    assert (
        summary['requests'] == 3
        and summary['reported_tokens'] == 455
        and summary['unreported_requests'] == 0
    )
    assert Decimal(summary['estimated_cost_usd']) == Decimal('0.0000091')
    assert summary['input_token_bound'] == sum(
        len(p['text'].encode()) for p in ingest.chunks_from_file('policy.txt', data)
    )
    assert [len(call['input']) for call in s['calls']] == [32, 32, 1]
    rows = db.all_rows(
        'SELECT * FROM embedding_usage WHERE project_id=%s ORDER BY ordinal', (s['pid'],)
    )
    assert all(row['usd_per_million'] == Decimal('0.02') for row in rows)
    assert rows[0]['provider_request_id'] == 'req_synthetic_1' and len(rows[0]['input_hash']) == 64
    assert 'Synthetic private passage' not in str(rows)
    assert 'synthetic-not-a-real-key' not in str(rows)
    assert not {'owner', 'attempt_id', 'project_id'} & result.json()['requests'][0].keys()
    with pytest.raises(CheckViolation):
        db.execute('UPDATE embedding_usage SET reported_tokens=0 WHERE id=%s', (rows[0]['id'],))
    with pytest.raises(CheckViolation):
        db.execute('UPDATE ingestion_jobs SET embedding_usd_per_million=3 WHERE id=%s', (jid,))
    duplicate = submit(client, s, data)
    assert execute(s, duplicate)['result']['deduplicated'] and len(s['calls']) == 3
    assert (
        client.get(f'/api/projects/{db.uid()}/collections/{s["cid"]}/embedding-usage').status_code
        == 404
    )
    assert client.get(s['base'] + f'/collections/{db.uid()}/embedding-usage').status_code == 404


@pytest.mark.integration
@pytest.mark.parametrize('variant', ['missing', 'unpriced', 'zero_rate'])
def test_unknown_usage_and_unknown_prices_remain_unavailable(client, scenario, variant):
    s = scenario
    if variant == 'missing':
        s['behavior'] = 'missing'
    else:
        s['rate'] = None if variant == 'unpriced' else 0
    jid = submit(client, s, b'Quasar retains source evidence for thirty days.')
    assert execute(s, jid)['status'] == 'ready'
    data = client.get(s['path'] + '/embedding-usage').json()
    assert data['summary']['requests'] == 1
    assert data['summary']['reported_tokens'] == (None if variant == 'missing' else 7)
    assert data['summary']['unreported_requests'] == (1 if variant == 'missing' else 0)
    assert (
        (Decimal(data['summary']['estimated_cost_usd']) == 0)
        if variant == 'zero_rate'
        else data['summary']['estimated_cost_usd'] is None
    )


@pytest.mark.integration
@pytest.mark.parametrize('stop', ['cancel', 'expire', 'revoke'])
def test_late_reported_usage_survives_stopping_and_no_next_batch_is_sent(client, scenario, stop):
    s = scenario
    content = '\n\n'.join(
        f'Quasar passage {i} remains private source evidence.' for i in range(33)
    ).encode()
    jid = submit(client, s, content)

    def stop_request():
        if stop == 'cancel':
            db.execute('UPDATE ingestion_jobs SET cancel_requested=true WHERE id=%s', (jid,))
        elif stop == 'expire':
            db.execute(
                "UPDATE ingestion_jobs SET lease_until=now()-interval '1 second' WHERE id=%s",
                (jid,),
            )
        else:
            db.execute('DELETE FROM project_memberships WHERE project_id=%s', (s['pid'],))

    s['after_response'] = stop_request
    result = execute(s, jid)
    worker.recover()
    result = db.one('SELECT * FROM ingestion_jobs WHERE id=%s', (jid,))
    assert result['status'] == ('cancelled' if stop == 'cancel' else 'failed')
    assert len(s['calls']) == 1
    usage = db.one('SELECT * FROM embedding_usage WHERE job_id=%s', (jid,))
    assert usage['status'] == 'reported' and usage['reported_tokens'] == 224
    assert (
        db.one('SELECT count(*) AS n FROM source_versions WHERE project_id=%s', (s['pid'],))['n']
        == 0
    )


@pytest.mark.integration
def test_index_rollback_keeps_provider_usage_but_no_source_version(client, scenario, monkeypatch):
    publish = ingest._publish

    def failure(*args):
        publish(*args)
        raise RuntimeError('synthetic-private-indexing-details')

    monkeypatch.setattr(ingest, '_publish', failure)
    jid = submit(client, scenario, b'Quasar source must keep paid usage if indexing fails.')
    assert execute(scenario, jid)['status'] == 'failed'
    data = client.get(scenario['path'] + '/embedding-usage').json()
    assert data['summary']['reported_tokens'] == 7
    assert 'synthetic-private-indexing-details' not in str(data)
    assert (
        db.one('SELECT count(*) AS n FROM source_versions WHERE project_id=%s', (scenario['pid'],))[
            'n'
        ]
        == 0
    )


@pytest.mark.integration
def test_ambiguous_reserved_request_is_not_replayed_or_reported_as_free(client, scenario):
    s = scenario
    jid = submit(client, s, b'Quasar source with an interrupted request boundary.')
    job = worker.lease(db.uid())
    recorder = worker.Control(job).embedding_recorder(s['pid'], s['cid'], job['version_id'])
    recorder.reserve(
        {
            'input': ['Earlier ambiguous input'],
            'model': 'text-embedding-3-small',
            'dimensions': 1536,
        }
    )
    worker.execute(job)
    assert db.one('SELECT status FROM ingestion_jobs WHERE id=%s', (jid,))['status'] == 'failed'
    assert s['calls'] == []
    summary = client.get(s['path'] + '/embedding-usage').json()['summary']
    assert summary['requests'] == summary['unreported_requests'] == 1
    assert summary['reported_tokens'] is None and summary['estimated_cost_usd'] is None


@pytest.mark.integration
def test_failure_and_explicit_retry_keep_separate_rates_without_automatic_calls(client, scenario):
    s = scenario
    s['behavior'] = 'error'
    jid = submit(client, s, b'Quasar retry must retain failed-attempt accounting.')
    assert execute(s, jid)['status'] == 'failed'
    assert len(s['calls']) == 1 and worker.lease(db.uid()) is None
    s['behavior'], s['rate'] = 'reported', 0.04
    retry_path = s['base'] + f'/ingestions/{jid}/retry'
    child = client.post(retry_path).json()['id']
    assert client.post(retry_path).json()['id'] == child
    assert execute(s, child)['status'] == 'ready' and len(s['calls']) == 2
    rows = db.all_rows(
        'SELECT * FROM embedding_usage WHERE project_id=%s ORDER BY created_at', (s['pid'],)
    )
    assert [row['usd_per_million'] for row in rows] == [Decimal('.02'), Decimal('.04')]
    assert rows[0]['status'] == 'unreported' and rows[1]['reported_tokens'] == 7
    assert 'synthetic-private-response-body' not in str(rows)
    summary = client.get(s['path'] + '/embedding-usage').json()['summary']
    assert summary['reported_tokens'] == 7 and summary['unreported_requests'] == 1
    assert summary['estimated_cost_usd'] is None


@pytest.mark.integration
def test_compatibility_upload_is_accounted_without_assigning_historical_usage(client, scenario):
    s = scenario
    empty = client.get(s['path'] + '/embedding-usage').json()['summary']
    assert empty['requests'] == 0 and empty['estimated_cost_usd'] is None and s['calls'] == []
    response = client.post(
        s['path'] + '/sources',
        files={'file': ('legacy.txt', b'Quasar compatibility source ingestion.')},
    )
    assert response.status_code == 201
    rows = client.get(s['path'] + '/embedding-usage').json()['requests']
    assert len(rows) == 1 and rows[0]['job_id'] is None and rows[0]['reported_tokens'] == 7
    assert rows[0]['source_version_id'] == response.json()['version_id']
