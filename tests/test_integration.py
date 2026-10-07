import concurrent.futures
import os
import subprocess
import sys
import time
import pytest
from workbench import db
from workbench.config import DEMO_PROJECT, DEMO_COLLECTION
from workbench.models import DEFAULT_QUESTION, EXAMPLES
from workbench.worker import lease, execute_run
from workbench.budget import reserve, BudgetExhausted
from workbench.evidence import verify
from workbench.models import Report

pytestmark = pytest.mark.integration
BASE = f'/api/projects/{DEMO_PROJECT}'


def create(client, **values):
    body = {
        'collection_id': DEMO_COLLECTION,
        'question': DEFAULT_QUESTION,
        'approve_plan': False,
        'idempotency_key': db.uid(),
        **values
    }
    response = client.post(BASE + '/runs', json=body)
    assert response.status_code == 202, response.text
    return response.json(), body


def drive(run_id):
    # Lease this test run through the production queue. Test DB is dedicated.
    for _ in range(100):
        run = lease('pytest-' + db.uid())
        assert run is not None
        execute_run(run)
        if str(run['id']) == run_id:
            return db.scoped_run(run_id, DEMO_PROJECT)
    raise AssertionError('Queue did not reach test run')


def test_complete_journey_and_idempotency(client):
    run, body = create(client)
    repeated = client.post(BASE + '/runs', json=body)
    assert repeated.json()['id'] == run['id']
    collision = client.post(BASE + '/runs', json={**body, 'question': EXAMPLES[1]})
    assert collision.status_code == 409
    completed = drive(run['id'])
    assert completed['status'] == 'completed', completed['error']
    data = client.get(BASE + f'/runs/{run["id"]}').json()
    assert len(data['evidence']) > 0 and len(data['contexts']) >= 3
    assert len(data['run']['report']['claims']) > 0
    verify(completed, Report.model_validate(completed['report']))
    events = client.get(BASE + f'/runs/{run["id"]}/events').json()
    cursor = events['cursor']
    assert len(events['events']) >= 8
    assert client.get(BASE + f'/runs/{run["id"]}/events?after={cursor}').json()['events'] == []
    assert client.get(BASE + f'/runs/{run["id"]}/report.md').status_code == 200


def test_real_vector_and_full_text_retrieval(database):
    from workbench.retrieval import search
    hits = search(DEMO_PROJECT, DEMO_COLLECTION, 'security retention', 5)
    assert any('vector' in hit['ranks'] for hit in hits)
    assert any('full_text' in hit['ranks'] for hit in hits)
    assert all(str(hit['chunk']['project_id']) == DEMO_PROJECT for hit in hits)
    assert all(hit['chunk']['embedding_config'] == 'demo-v1' for hit in hits)


def test_two_projects_and_citation_storage_isolation(client):
    hidden = db.uid()
    user = db.uid()
    collection = db.uid()
    db.execute('INSERT INTO projects VALUES(%s,%s,now())', (hidden, 'Private control project'))
    db.execute("INSERT INTO project_memberships VALUES(%s,%s,'owner')", (hidden, user))
    db.execute(
        "INSERT INTO collections(id,project_id,name,embedding_config) VALUES(%s,%s,'Secret','demo-v1')",
        (collection, hidden))
    assert client.get(f'/api/projects/{hidden}').status_code == 404
    assert client.post(BASE + '/search', json={
        'collection_id': collection,
        'query': 'security'
    }).status_code == 422
    assert client.get(f'/api/projects/{hidden}/evidence/{db.uid()}').status_code == 404
    assert client.get(f'/api/projects/{hidden}/versions/{db.uid()}/download').status_code == 404
    assert client.post(BASE + '/runs',
                       json={
                           'collection_id': collection,
                           'question': DEFAULT_QUESTION,
                           'idempotency_key': db.uid()
                       }).status_code == 404


def test_approval_checkpoint_resume(client):
    run, _ = create(client, approve_plan=True)
    paused = drive(run['id'])
    assert paused['status'] == 'awaiting_approval'
    plan = paused['plan']
    plan['tasks'][0]['question'] = 'security retention current requirements'
    response = client.post(BASE + f'/runs/{run["id"]}/approve', json=plan)
    assert response.status_code == 202
    completed = drive(run['id'])
    assert completed['status'] == 'completed'
    assert completed['plan'] == plan
    assert db.one("SELECT count(*) AS n FROM contexts WHERE run_id=%s AND stage='plan'",
                  (run['id'], ))['n'] == 1


def test_arbitrary_demo_questions_explain_limitations(client):
    response = client.post(BASE + '/runs',
                           json={
                               'collection_id': DEMO_COLLECTION,
                               'question': 'Who won a real election yesterday?',
                               'idempotency_key': db.uid()
                           })
    assert response.status_code == 422 and 'seeded questions' in response.json()['detail']


def test_budget_exhaustion_is_partial(client):
    run, _ = create(client, limits={'tokens': 500, 'tool_calls': 1})
    finished = drive(run['id'])
    assert finished['status'] == 'partial'
    assert finished['report']['partial'] is True
    assert finished['tokens_used'] <= 500


def test_iteration_limit_and_insufficient_evidence(client):
    run, _ = create(client, question=EXAMPLES[-1], limits={'iterations': 1})
    result = drive(run['id'])
    assert result['status'] == 'partial'
    assert any('million' in x for x in result['report']['limitations'])
    assert db.one('SELECT max(iteration) AS n FROM research_tasks WHERE run_id=%s',
                  (run['id'], ))['n'] == 1


def test_cancellation_of_queued_job(client):
    run, _ = create(client)
    assert client.post(BASE + f'/runs/{run["id"]}/cancel').status_code == 200
    row = db.scoped_run(run['id'], DEMO_PROJECT)
    assert row['cancel_requested'] and row['status'] == 'cancelled'


def test_parallel_budget_is_atomic(client):
    run, _ = create(client, limits={'tool_calls': 2, 'concurrency': 3})
    leased = lease('parallel-test')
    assert str(leased['id']) == run['id']

    def claim(i):
        try:
            reserve(leased, f'test-parallel-{i}', tools=1)
            return True
        except BudgetExhausted:
            return False

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(claim, range(6)))
    assert sum(results) == 2
    assert db.scoped_run(run['id'], DEMO_PROJECT)['tools_used'] == 2
    client.post(BASE + f'/runs/{run["id"]}/cancel')
    execute_run(leased)


def test_transient_timeout_retries_then_succeeds(client, monkeypatch):
    from workbench.providers import DemoProvider
    original = DemoProvider.invoke
    count = 0

    def flaky(self, *args, **kwargs):
        nonlocal count
        count += 1
        if count == 1:
            raise TimeoutError('injected test timeout')
        return original(self, *args, **kwargs)

    monkeypatch.setattr(DemoProvider, 'invoke', flaky)
    run, _ = create(client)
    assert drive(run['id'])['status'] == 'retrying'
    db.execute('UPDATE research_runs SET available_at=now() WHERE id=%s', (run['id'], ))
    assert drive(run['id'])['status'] == 'completed'
    assert db.one("SELECT count(*) AS n FROM run_events WHERE run_id=%s AND stage='retry'",
                  (run['id'], ))['n'] == 1


def test_checkpoint_survives_process_restart(client):
    # Pause in one OS process, terminate it, approve and complete in a fresh process.
    run, _ = create(client, approve_plan=True)
    env = {**os.environ, 'LEASE_SECONDS': '3', 'POLL_SECONDS': '0.1'}
    first = subprocess.Popen([sys.executable, '-m', 'workbench.worker'], env=env)
    try:
        wait_status(run['id'], {'awaiting_approval'})
        first.kill()
        first.wait(timeout=5)
        row = db.scoped_run(run['id'], DEMO_PROJECT)
        assert client.post(BASE + f'/runs/{run["id"]}/approve', json=row['plan']).status_code == 202
        second = subprocess.Popen([sys.executable, '-m', 'workbench.worker'], env=env)
        try:
            assert wait_status(run['id'], {'completed', 'failed', 'partial'}) == 'completed'
        finally:
            second.terminate()
            second.wait(timeout=45)
        assert db.one("SELECT count(*) AS n FROM run_events WHERE run_id=%s AND event_key='plan'",
                      (run['id'], ))['n'] == 1
    finally:
        if first.poll() is None:
            first.kill()
            first.wait(timeout=5)


def test_expired_lease_recovery(client):
    run, _ = create(client)
    first = lease('worker-that-crashed')
    assert str(first['id']) == run['id']
    db.execute("UPDATE research_runs SET lease_until=now()-interval '1 second' WHERE id=%s",
               (run['id'], ))
    recovered = drive(run['id'])
    assert recovered['attempts'] == 2 and recovered['status'] == 'completed'


def wait_status(run_id, statuses):
    deadline = time.monotonic() + 50
    while time.monotonic() < deadline:
        state = db.scoped_run(run_id, DEMO_PROJECT)['status']
        if state in statuses:
            return state
        time.sleep(.1)
    raise AssertionError('Timed out waiting for worker')


def test_cancellation_during_active_call(client, monkeypatch):
    import threading
    from workbench.providers import DemoProvider
    entered = threading.Event()
    release = threading.Event()
    original = DemoProvider.invoke

    def slow(self, *args, **kwargs):
        entered.set()
        release.wait(timeout=5)
        return original(self, *args, **kwargs)

    monkeypatch.setattr(DemoProvider, 'invoke', slow)
    run, _ = create(client)
    leased = lease('cancel-active')
    assert str(leased['id']) == run['id']
    thread = threading.Thread(target=execute_run, args=(leased, ))
    thread.start()
    try:
        assert entered.wait(timeout=5)
        client.post(BASE + f'/runs/{run["id"]}/cancel')
    finally:
        release.set()
        thread.join(timeout=10)
    assert db.scoped_run(run['id'], DEMO_PROJECT)['status'] == 'cancelled'
    assert db.one('SELECT count(*) AS n FROM evidence WHERE run_id=%s', (run['id'], ))['n'] == 0


def test_document_replacement_preserves_pinned_versions(client):
    from workbench.retrieval import search
    response = client.post(BASE + '/collections',
                           json={'name': 'Version isolation ' + db.uid()[:8]})
    collection = response.json()['id']
    path = BASE + f'/collections/{collection}/sources'
    old = b'Alpha security requirements are synthetic and belong to the first immutable source version.'
    new = b'Beta security requirements replace the previous assumption in a second immutable source version.'
    first = client.post(path, files={'file': ('version-test.txt', old, 'text/plain')}).json()
    run, _ = create(client, collection_id=collection)
    second = client.post(path, files={'file': ('version-test.txt', new, 'text/plain')}).json()
    assert first['version_id'] != second['version_id']
    snapshot = db.scoped_run(run['id'], DEMO_PROJECT)['corpus_versions']
    assert snapshot == [first['version_id']]
    historical = search(DEMO_PROJECT, collection, 'alpha', 5, snapshot)
    assert historical and 'Alpha' in historical[0]['chunk']['text']
    current = search(DEMO_PROJECT, collection, 'beta', 5)
    assert current and 'Beta' in current[0]['chunk']['text']
    reverted = client.post(path, files={'file': ('version-test.txt', old, 'text/plain')}).json()
    assert reverted['deduplicated'] and reverted['version_id'] == first['version_id']
    assert 'Alpha' in search(DEMO_PROJECT, collection, 'alpha', 5)[0]['chunk']['text']
    client.post(BASE + f'/runs/{run["id"]}/cancel')


def test_failed_error_handler_leaves_recoverable_lease(client, monkeypatch):
    from workbench import worker
    original = worker.partial_report
    run, _ = create(client, limits={'tokens': 500})
    leased = lease('failed-error-handler')
    assert str(leased['id']) == run['id']

    def failed_persistence(*args):
        raise RuntimeError('simulated failure while persisting partial result')

    monkeypatch.setattr(worker, 'partial_report', failed_persistence)
    with pytest.raises(RuntimeError):
        execute_run(leased)
    row = db.scoped_run(run['id'], DEMO_PROJECT)
    assert row['status'] == 'running' and row['lease_until'] is not None
    monkeypatch.setattr(worker, 'partial_report', original)
    assert drive(run['id'])['status'] == 'partial'
