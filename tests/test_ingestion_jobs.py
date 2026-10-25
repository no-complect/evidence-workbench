"""Durable upload API/worker boundaries against real Postgres; no paid calls."""
from concurrent.futures import ThreadPoolExecutor
import threading

import pytest
from psycopg.errors import CheckViolation

from workbench import db, ingest, ingestion_worker as worker

pytestmark = pytest.mark.integration


@pytest.fixture
def scope(client):
    pid = client.post('/api/projects', json={'name': 'Durable uploads'}).json()['id']
    base = f'/api/projects/{pid}'
    cid = client.post(base + '/collections', json={'name': 'Sources'}).json()['id']
    yield {'base': base, 'path': base + f'/collections/{cid}', 'pid': pid, 'cid': cid}
    db.execute("UPDATE ingestion_jobs SET status='cancelled',phase='finished' WHERE project_id=%s AND status IN ('queued','running')", (pid,))


def submit(client, scope, data=b'Quasar policy retains source documents for thirty days.', key=None, name='policy.txt'):
    return client.post(scope['path'] + '/ingestions', data={'idempotency_key': key or db.uid()},
                       files={'file': (name, data, 'text/plain')})


def saved(scope, jid):
    return db.one('SELECT * FROM ingestion_jobs WHERE id=%s AND project_id=%s', (jid, scope['pid']))


def execute(scope, jid):
    job = worker.lease(db.uid())
    assert str(job['id']) == jid
    worker.execute(job)
    return saved(scope, jid)


def test_submission_returns_durable_intent_without_parsing_or_models_and_is_idempotent(client, scope, monkeypatch):
    def forbidden(*args):
        raise AssertionError('Request path must not parse or embed')
    monkeypatch.setattr(ingest, 'chunks_from_file', forbidden)
    monkeypatch.setattr(ingest, 'embed_passages', forbidden)
    key = db.uid()
    first = submit(client, scope, key=key)
    assert first.status_code == 202, first.text
    jid = first.json()['id']
    assert first.json()['status'] == 'queued'
    assert client.get(scope['path'] + '/sources').json() == []
    assert submit(client, scope, key=key).json()['id'] == jid
    assert submit(client, scope, data=b'Different source bytes.', key=key).status_code == 409
    assert submit(client, scope).status_code == 409
    rows = client.get(scope['base'] + '/ingestions').json()
    assert len(rows) == 1
    assert not {'storage_key', 'request_key', 'created_by', 'lease_owner', 'content_hash'} & rows[0].keys()
    unknown = '/api/projects/' + db.uid()
    assert client.get(unknown + '/ingestions').status_code == 404
    assert client.post(unknown + f'/ingestions/{jid}/retry').status_code == 404
    assert client.post(unknown + f'/ingestions/{jid}/cancel').status_code == 404
    assert client.post(unknown + f'/collections/{scope["cid"]}/ingestions',
                       data={'idempotency_key': db.uid()}, files={'file': ('x.txt', b'private')}).status_code == 404


def test_queued_cancel_and_explicit_retry_survive_new_worker_and_reuse_attempt(client, scope):
    jid = submit(client, scope).json()['id']
    cancel = scope['base'] + f'/ingestions/{jid}/cancel'
    assert client.post(cancel).json()['status'] == 'cancelled'
    assert worker.lease(db.uid()) is None
    retry = scope['base'] + f'/ingestions/{jid}/retry'
    child = client.post(retry).json()['id']
    assert client.post(retry).json()['id'] == child
    outcome = execute(scope, child)
    assert outcome['status'] == 'ready' and outcome['phase'] == 'finished'
    source, = client.get(scope['path'] + '/sources').json()
    assert source['current_version_id'] == str(outcome['version_id'])
    assert outcome['result']['version_id'] == source['current_version_id']
    assert source['version_count'] == source['chunk_count'] == 1
    for sql in ["UPDATE ingestion_jobs SET name='changed.txt' WHERE id=%s",
                "UPDATE ingestion_jobs SET status='failed',result=NULL WHERE id=%s"]:
        with pytest.raises(CheckViolation):
            db.execute(sql, (child,))


def test_worker_failure_preserves_previous_version_and_explicit_retry_recovers(client, scope, monkeypatch):
    old = client.post(scope['path'] + '/sources', files={'file': ('policy.txt', b'Quasar old policy remains searchable.')}).json()
    calls = []
    def embed(passages, profile):
        calls.append(profile)
        if len(calls) == 1:
            raise ingest.IngestionError('Embedding provider is temporarily unavailable. Retry this file later.')
        return [None] * len(passages)
    monkeypatch.setattr(ingest, 'embed_passages', embed)
    key = db.uid()
    content = b'Quasar changed policy requires independent review.'
    jid = submit(client, scope, content, key).json()['id']
    assert execute(scope, jid)['status'] == 'failed'
    source, = client.get(scope['path'] + '/sources').json()
    assert source['current_version_id'] == old['version_id'] and source['version_count'] == 1
    assert submit(client, scope, content, key).json()['status'] == 'failed'
    worker.recover()
    assert worker.lease(db.uid()) is None and len(calls) == 1
    retry = scope['base'] + f'/ingestions/{jid}/retry'
    child = client.post(retry).json()['id']
    assert client.post(retry).json()['id'] == child
    assert execute(scope, child)['status'] == 'ready' and len(calls) == 2
    source, = client.get(scope['path'] + '/sources').json()
    assert source['version_count'] == 2 and source['status'] == 'ready'
    duplicate = submit(client, scope, content).json()['id']
    assert execute(scope, duplicate)['result']['deduplicated'] and len(calls) == 2


@pytest.mark.parametrize('stop', ['cancel', 'expire'])
def test_inflight_cancel_or_expired_lease_cannot_publish_or_automatically_repeat(client, scope, monkeypatch, stop):
    old = client.post(scope['path'] + '/sources', files={'file': ('policy.txt', b'Quasar original source evidence.')}).json()
    entered, release = threading.Event(), threading.Event()
    calls = []
    def embed(passages, profile):
        calls.append(profile)
        entered.set()
        assert release.wait(15)
        return [None] * len(passages)
    monkeypatch.setattr(ingest, 'embed_passages', embed)
    jid = submit(client, scope, b'Quasar replacement must not publish after stopping.').json()['id']
    job = worker.lease(db.uid())
    with ThreadPoolExecutor(max_workers=1) as pool:
        task = pool.submit(worker.execute, job)
        try:
            assert entered.wait(10)
            if stop == 'cancel':
                client.post(scope['base'] + f'/ingestions/{jid}/cancel')
            else:
                db.execute("UPDATE ingestion_jobs SET lease_until=now()-interval '1 second' WHERE id=%s", (jid,))
                worker.recover()
                assert saved(scope, jid)['status'] == 'running', 'Live document guard must fence recovery'
        finally:
            release.set()
        task.result(timeout=10)
    worker.recover()
    assert saved(scope, jid)['status'] == ('cancelled' if stop == 'cancel' else 'failed')
    assert worker.lease(db.uid()) is None and len(calls) == 1
    source, = client.get(scope['path'] + '/sources').json()
    assert source['current_version_id'] == old['version_id'] and source['version_count'] == 1
    with db.connection() as conn, pytest.raises(ingest.IngestionLeaseLost):
        worker.Control(job).finish(conn, {})


def test_source_and_job_completion_roll_back_together(client, scope, monkeypatch):
    finish = worker.Control.finish
    def interrupted(self, conn, result):
        finish(self, conn, result)
        raise RuntimeError('private-database-or-source-details')
    monkeypatch.setattr(worker.Control, 'finish', interrupted)
    jid = submit(client, scope).json()['id']
    result = execute(scope, jid)
    assert result['status'] == 'failed' and result['result'] is None
    assert 'private-' not in result['error']
    source, = client.get(scope['path'] + '/sources').json()
    assert source['current_version_id'] is None and source['version_count'] == source['chunk_count'] == 0


def test_two_workers_lease_different_uploads(client, scope):
    ids = {submit(client, scope, name=name).json()['id'] for name in ['one.txt', 'two.txt']}
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs = list(pool.map(lambda _: worker.lease(db.uid()), range(2)))
    assert {str(job['id']) for job in jobs} == ids
    for job in jobs:
        worker.execute(job)
    assert all(saved(scope, jid)['status'] == 'ready' for jid in ids)
