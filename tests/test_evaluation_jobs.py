"""Exercise queue authorization, idempotency, real execution and crash recovery."""
import threading
from contextlib import contextmanager
import pytest
from workbench import db
from workbench.evaluation_worker import lease, execute_job, EvaluationLeaseLost
from workbench.worker import lease as research_lease, execute_run

pytestmark = pytest.mark.integration


def project(client):
    result = client.post('/api/projects', json={'name': 'Benchmark queue test'})
    assert result.status_code == 201
    return result.json()['id']


def submit(client, pid, **values):
    body = {'split': 'development', 'idempotency_key': db.uid(), **values}
    response = client.post(f'/api/projects/{pid}/evaluation-jobs', json=body)
    assert response.status_code == 202, response.text
    return response.json(), body


@contextmanager
def research_executor():
    stop = threading.Event()
    errors = []

    def execute():
        try:
            while not stop.is_set():
                run = research_lease('eval-test-' + db.uid())
                if run:
                    execute_run(run)
                else:
                    stop.wait(.02)
        except Exception as exc:
            errors.append(exc)

    thread = threading.Thread(target=execute, daemon=True)
    thread.start()
    try:
        yield
    finally:
        stop.set()
        thread.join(timeout=20)
        assert not thread.is_alive(), 'Research worker failed to stop'
        assert not errors, errors


def test_evaluation_authorization_idempotency_and_queue_cancellation(client):
    pid = project(client)
    path = f'/api/projects/{pid}/evaluation-jobs'
    job, body = submit(client, pid)
    assert client.post(path, json=body).json()['id'] == job['id']
    assert client.post(path, json={**body, 'split': 'held-out'}).status_code == 409
    assert client.post(path, json={**body, 'idempotency_key': db.uid()}).status_code == 409
    assert client.get(path).json()[0]['id'] == job['id']
    assert 'lease_owner' not in client.get(path).json()[0]
    unknown = db.uid()
    assert client.get(f'/api/projects/{unknown}/evaluation-jobs').status_code == 404
    assert client.post(f'/api/projects/{unknown}/evaluation-jobs', json=body).status_code == 404
    assert client.get(f'/api/projects/{unknown}/evaluation-jobs/{job["id"]}').status_code == 404
    client.post(path + f'/{job["id"]}/cancel')
    assert client.get(path + f'/{job["id"]}').json()['status'] == 'cancelled'
    assert client.post(path, json={**body, 'split': 'live', 'idempotency_key': db.uid()}).status_code == 422


def test_evaluation_executes_and_reuses_cases_after_worker_restart(client, monkeypatch):
    from workbench import evaluation_worker
    pid = project(client)
    job, _ = submit(client, pid)
    original = evaluation_worker.run_evaluation

    def crash_after_first_case(*args, **kwargs):
        progress = kwargs['progress']

        def crash(value):
            progress(value)
            if value.get('completed') == 1:
                raise EvaluationLeaseLost()

        return original(*args, **{**kwargs, 'progress': crash})

    monkeypatch.setattr(evaluation_worker, 'run_evaluation', crash_after_first_case)
    with research_executor():
        first = lease('crashed-evaluator')
        assert str(first['id']) == job['id']
        execute_job(first)
        saved = db.one('SELECT * FROM evaluation_jobs WHERE id=%s', (job['id'],))
        assert saved['status'] == 'running' and saved['progress']['completed'] == 1
        first_run = db.one('SELECT id FROM research_runs WHERE evaluation_job_id=%s', (job['id'],))
        monkeypatch.setattr(evaluation_worker, 'run_evaluation', original)
        recovered = lease('replacement-evaluator')
        assert str(recovered['id']) == job['id'] and recovered['attempts'] == 2
        execute_job(recovered)
    detail = client.get(f'/api/projects/{pid}/evaluation-jobs/{job["id"]}').json()
    assert detail['status'] == 'completed', detail
    assert detail['progress']['completed'] == detail['progress']['total'] == 15
    result = db.one('SELECT * FROM evaluation_runs WHERE id=%s AND project_id=%s',
                    (detail['result_id'], pid))
    assert len(result['raw']) == 15 and len(result['results']) == 3
    children = db.all_rows('SELECT * FROM research_runs WHERE evaluation_job_id=%s', (job['id'],))
    assert len(children) == 15  # the completed first case was not executed a second time
    assert first_run['id'] in [r['id'] for r in children]
    assert all(str(r['project_id']) == pid for r in children)
    assert all(len(r['corpus_versions']) > 0 for r in children)
    assert result['versions']['source_hashes']
    assert all(r['mode'] == 'demo' for r in children)
    upload = client.post(
        f'/api/projects/{pid}/collections/{job["id"]}/sources',
        files={'file': ('unknown.txt', b'Unknown collection', 'text/plain')})
    assert upload.status_code == 404
    upload = client.post(
        f'/api/projects/{pid}/collections/{result["versions"]["collection_id"]}/sources',
        files={'file': ('attempt.txt', b'Mutate the benchmark corpus', 'text/plain')})
    assert upload.status_code == 409 and 'read-only' in upload.json()['detail']


def test_active_evaluation_cancellation_stops_child_runs(client, monkeypatch):
    from workbench import evaluation_worker
    from workbench.models import RunCreate, EXAMPLES
    from workbench.runs import create_run
    from workbench.config import DEMO_USER
    pid = project(client)
    job, _ = submit(client, pid)

    def cancel_during_execution(*args, **kwargs):
        collection = db.uid()
        db.execute("INSERT INTO collections(id,project_id,name,embedding_config) "
                   "VALUES(%s,%s,'Cancel test','demo-v1')", (collection, pid))
        create_run(pid, RunCreate(collection_id=collection, question=EXAMPLES[0],
                                 idempotency_key=db.uid()), DEMO_USER,
                   evaluation_job_id=job['id'])
        response = client.post(f'/api/projects/{pid}/evaluation-jobs/{job["id"]}/cancel')
        assert response.status_code == 200
        kwargs['check_active']()

    monkeypatch.setattr(evaluation_worker, 'run_evaluation', cancel_during_execution)
    leased = lease('cancel-evaluator')
    assert str(leased['id']) == job['id']
    execute_job(leased)
    assert db.one('SELECT status FROM evaluation_jobs WHERE id=%s',
                  (job['id'],))['status'] == 'cancelled'
    children = db.all_rows('SELECT * FROM research_runs WHERE evaluation_job_id=%s', (job['id'],))
    assert children and all(r['cancel_requested'] and r['status'] == 'cancelled' for r in children)


def test_benchmark_drift_fails_before_any_research_run(client, monkeypatch):
    from workbench import evaluation_worker
    pid = project(client)
    job, _ = submit(client, pid)
    monkeypatch.setattr(evaluation_worker, 'benchmark_versions', lambda: {'code_sha256': 'changed'})
    leased = lease('drift-evaluator')
    assert str(leased['id']) == job['id']
    execute_job(leased)
    assert db.one('SELECT status FROM evaluation_jobs WHERE id=%s', (job['id'],))['status'] == 'failed'
    assert not db.all_rows('SELECT id FROM research_runs WHERE evaluation_job_id=%s', (job['id'],))


def test_collection_evaluation_freezes_sources_expectations_and_configuration(client):
    from workbench.models import EXAMPLES
    pid = project(client)
    collection = client.post(f'/api/projects/{pid}/collections', json={'name':'Evaluation collection','embedding_config':'demo-v1'}).json()['id']
    endpoint = f'/api/projects/{pid}/collections/{collection}/sources'
    old_text = 'Original retention requirement: keep security audit data for seven days and restrict access to authorized staff only. '
    upload = client.post(endpoint, files={'file':('security.md',old_text.encode(),'text/markdown')})
    assert upload.status_code == 201, upload.text
    original_version = upload.json()['version_id']
    custom = {'collection_id':collection,'mode':'demo','harness_config':{'system_instruction':'Preserve missing evidence.','context_policy':'strict'},
              'cases':[{'question':EXAMPLES[1],'query':'security retention','expected_sources':['security.md']}]}
    job, body = submit(client, pid, custom=custom)
    path = f'/api/projects/{pid}/evaluation-jobs'
    assert client.post(path,json=body).json()['id'] == job['id']
    assert client.post(path,json={**body,'custom':{**custom,'cases':[{'question':EXAMPLES[1],'query':'security','expected_sources':['wrong.md']}]}}).status_code == 409
    assert job['request']['custom']['version_ids'] == [original_version]
    replacement = client.post(endpoint, files={'file':('security.md',b'Replacement retention guidance. This version must not replace the pinned source of an already queued evaluation.','text/markdown')})
    assert replacement.status_code == 201
    with research_executor():
        leased = lease('collection-evaluator')
        assert str(leased['id']) == job['id']
        execute_job(leased)
    saved = db.one('SELECT * FROM evaluation_jobs WHERE id=%s', (job['id'],))
    assert saved['status'] == 'completed', saved['error']
    children = db.all_rows('SELECT * FROM research_runs WHERE evaluation_job_id=%s', (job['id'],))
    assert len(children) == 3
    assert all(r['corpus_versions'] == [original_version] for r in children)
    assert all(r['request']['harness_config']['context_policy'] == 'strict' for r in children)
    result = db.one('SELECT * FROM evaluation_runs WHERE id=%s', (job['id'],))
    assert result['versions']['source_version_ids'] == [original_version]
    assert len(result['raw']) == 3 and result['versions']['expectations'][0]['expected_sources'] == ['security.md']
    assert all(r['status'] == 'completed' for r in result['raw'])
    assert any('Original retention' in c['text'] for r in children for c in r['report']['claims'])
    assert client.post(path,json={**body,'idempotency_key':db.uid(),'custom':{**custom,'mode':'live'}}).status_code == 409
    other = project(client)
    assert client.post(f'/api/projects/{other}/evaluation-jobs', json={**body,'idempotency_key':db.uid()}).status_code == 409
