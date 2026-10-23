"""Real SQL/queues/graphs; synthetic model and embedding responses, never paid calls."""
from types import SimpleNamespace
import time
import pytest
from psycopg.errors import CheckViolation
from workbench import api, db, environment_models, evaluation_api, graph, ingest, judging, judge_policy, retrieval, runs, worker
from workbench.config import settings
from workbench.models import Claim, SemanticJudgment, EXAMPLES
from workbench.providers import DemoProvider
from workbench.evaluation_worker import lease, execute_job
from test_evaluation_jobs import research_executor

pytestmark = pytest.mark.integration
SECRET = 'synthetic-judge-key-never-sent-to-a-provider'


@pytest.fixture
def scenario(client, monkeypatch):
    profile = settings().model_copy(update={'live_enabled': True, 'openai_api_key': SECRET,
        'openai_model': 'writer-family', 'model_input_usd_per_million': 1,
        'model_output_usd_per_million': 2, 'embedding_usd_per_million': 0.1})
    for module in [api, evaluation_api, environment_models, graph, runs, worker, judging]:
        monkeypatch.setattr(module, 'settings', lambda: profile)
    monkeypatch.setattr(environment_models, 'catalog', lambda *a: {'models': ['writer-family', 'judge-family']})
    monkeypatch.setattr(ingest, 'embed_passages', lambda passages, config: [[.1] * 1536 for p in passages])
    monkeypatch.setattr(retrieval, 'query_vector', lambda *a: [.1] * 1536)

    class ResearchProvider:
        name = 'openai'
        def __init__(self, *args): pass
        def invoke(self, stage, payload, schema, timeout=35):
            result, _, _ = DemoProvider().invoke(stage, payload, schema)
            if stage == 'report' and result.claims:
                result.claims.append(Claim(text='Keep audit logs for seven days.',
                    evidence_ids=result.claims[0].evidence_ids, support='direct_quote'))
            return result, 100, None
    monkeypatch.setattr(graph, 'OpenAIProvider', ResearchProvider)
    calls = []

    class Judge:
        def __init__(self, pinned, key):
            assert key == SECRET
            self.pinned = pinned
        def invoke(self, content, timeout):
            calls.append((self.pinned['model_id'], content))
            assert 0 < timeout <= 30
            return {'parsed': SemanticJudgment(label='supported', reason='The cited passage states this requirement.'),
                'parsing_error': None, 'raw': SimpleNamespace(usage_metadata={'input_tokens': 13, 'output_tokens': 7})}
    monkeypatch.setattr(judge_policy, 'SemanticJudge', Judge)
    pid = client.post('/api/projects', json={'name': 'Semantic grading test'}).json()['id']
    cid = client.post(f'/api/projects/{pid}/collections', json={'name': 'Cited requirements', 'embedding_config': 'openai-small-v1'}).json()['id']
    upload = client.post(f'/api/projects/{pid}/collections/{cid}/sources', files={'file': ('security.md',
        b'Security controls are required for the AI assistant. Investigate security evidence and unresolved assumptions. Keep audit logs for seven days. Access is restricted to authorized staff and reviewed regularly.', 'text/markdown')})
    assert upload.status_code == 201, upload.text

    def submit(**limits):
        model = limits.pop('model_id', 'judge-family')
        body = {'split': 'development', 'idempotency_key': db.uid(), 'custom': {
            'collection_id': cid, 'mode': 'live', 'model_id': 'writer-family', 'confirm_paid': True,
            'judge': {'model_id': model, 'max_claims_per_run': 1, **limits},
            'cases': [{'question': EXAMPLES[1], 'query': 'security controls', 'expected_sources': ['security.md']}]}}
        response = client.post(f'/api/projects/{pid}/evaluation-jobs', json=body)
        assert response.status_code == 202, response.text
        return response.json(), body
    return SimpleNamespace(pid=pid, cid=cid, profile=profile, submit=submit, calls=calls, Judge=Judge)


def execute(scenario, owner):
    with research_executor():
        job = lease(owner)
        assert str(job['project_id']) == scenario.pid
        execute_job(job)
    return job


def test_live_judge_is_pinned_scoped_durable_and_separate_from_deterministic_checks(client, scenario):
    job, body = scenario.submit()
    request = job['request']['custom']['judge_snapshot']
    assert request['model_id'] == 'judge-family' and not request['cost_estimates_available']
    assert SECRET not in str(job) and scenario.calls == []
    # Queue replay neither discovers nor grades again, even if server defaults change.
    scenario.profile.openai_model = 'changed-default'
    assert client.post(f'/api/projects/{scenario.pid}/evaluation-jobs', json=body).json()['id'] == job['id']
    execute(scenario, 'judge-success')
    result = db.one('SELECT * FROM evaluation_runs WHERE id=%s', (job['id'],))
    assert len(scenario.calls) == 3 and {model for model, _ in scenario.calls} == {'judge-family'}
    assert all(r['judging']['graded'] == 1 and r['judging']['unsampled'] >= 1 for r in result['raw'])
    assert all(r['judging']['judgments'][0]['tokens_charged'] == 20 for r in result['raw'])
    assert all(r['judging']['judgments'][0]['result']['estimated_cost_usd'] is None for r in result['raw'])
    assert all('semantic' not in str(r['checks']) for r in result['raw'])
    endpoint = f'/api/projects/{scenario.pid}/evaluation-jobs/{job["id"]}/judgments'
    saved = client.get(endpoint)
    assert len(saved.json()) == 3 and SECRET not in saved.text
    assert client.get(f'/api/projects/{db.uid()}/evaluation-jobs/{job["id"]}/judgments').status_code == 404
    row = saved.json()[0]
    with pytest.raises(CheckViolation):
        db.execute('UPDATE evaluation_judgments SET request=%s WHERE id=%s', (db.jsonb({}), row['id']))


@pytest.mark.parametrize('limits', [{'tokens': 1000}, {'estimated_cost_usd': 0, 'model_id': 'writer-family'}])
def test_judge_budget_stops_create_explicit_ungraded_rows_without_inference(client, scenario, limits):
    job, _ = scenario.submit(**limits)
    execute(scenario, 'judge-budget')
    rows = client.get(f'/api/projects/{scenario.pid}/evaluation-jobs/{job["id"]}/judgments').json()
    assert len(rows) == 3 and scenario.calls == []
    assert all(row['status'] == 'ungraded' and row['tokens_charged'] == 0 for row in rows)
    assert all('budget exhausted' in row['result']['reason'] for row in rows)


def test_uncertain_call_is_not_replayed_after_evaluation_worker_recovery(client, scenario, monkeypatch):
    job, _ = scenario.submit()
    original = scenario.Judge.invoke
    class Crash(BaseException):
        pass
    def crash(self, content, timeout):
        scenario.calls.append((self.pinned['model_id'], content))
        raise Crash()
    monkeypatch.setattr(scenario.Judge, 'invoke', crash)
    with pytest.raises(Crash):
        execute(scenario, 'judge-crash')
    first = scenario.calls[0][1]
    monkeypatch.setattr(scenario.Judge, 'invoke', original)
    execute(scenario, 'judge-recovery')
    rows = client.get(f'/api/projects/{scenario.pid}/evaluation-jobs/{job["id"]}/judgments').json()
    assert len(rows) == 3 and len(scenario.calls) == 3
    assert sum(content == first for _, content in scenario.calls) == 1
    uncertain = [row for row in rows if row['status'] == 'ungraded']
    assert len(uncertain) == 1 and uncertain[0]['tokens_charged'] == uncertain[0]['token_bound']
    assert 'not retried' in uncertain[0]['result']['reason']
    assert db.one('SELECT count(*) n FROM research_runs WHERE evaluation_job_id=%s', (job['id'],))['n'] == 3


def test_cancellation_saves_completed_grade_but_prevents_next_judge_call(client, scenario, monkeypatch):
    job, _ = scenario.submit()
    original = scenario.Judge.invoke
    def cancel(self, content, timeout):
        output = original(self, content, timeout)
        client.post(f'/api/projects/{scenario.pid}/evaluation-jobs/{job["id"]}/cancel')
        return output
    monkeypatch.setattr(scenario.Judge, 'invoke', cancel)
    execute(scenario, 'judge-cancel')
    detail = client.get(f'/api/projects/{scenario.pid}/evaluation-jobs/{job["id"]}').json()
    assert detail['status'] == 'cancelled' and len(scenario.calls) == 1
    rows = client.get(f'/api/projects/{scenario.pid}/evaluation-jobs/{job["id"]}/judgments').json()
    assert len(rows) == 1 and rows[0]['status'] == 'graded'


def test_invalid_judge_schema_still_accounts_reported_usage_and_keeps_errors_private(client, scenario, monkeypatch):
    job, _ = scenario.submit(model_id='writer-family')
    scenario.profile.model_input_usd_per_million = 99
    scenario.profile.model_output_usd_per_million = 88
    def malformed(self, content, timeout):
        scenario.calls.append((self.pinned['model_id'], content))
        return {'parsed': None, 'parsing_error': RuntimeError(SECRET),
            'raw': SimpleNamespace(usage_metadata={'input_tokens': 13, 'output_tokens': 7})}
    monkeypatch.setattr(scenario.Judge, 'invoke', malformed)
    execute(scenario, 'judge-schema')
    response = client.get(f'/api/projects/{scenario.pid}/evaluation-jobs/{job["id"]}/judgments')
    assert SECRET not in response.text
    assert all(r['status'] == 'ungraded' and r['tokens_charged'] == 20 for r in response.json())
    assert all(r['result']['estimated_cost_usd'] == pytest.approx(.000027) for r in response.json())


def test_failed_calls_without_usage_retain_the_reservation_and_do_not_expose_errors(client, scenario, monkeypatch):
    job, _ = scenario.submit(model_id='writer-family')
    def failed(self, content, timeout):
        scenario.calls.append((self.pinned['model_id'], content))
        raise TimeoutError(SECRET)
    monkeypatch.setattr(scenario.Judge, 'invoke', failed)
    execute(scenario, 'judge-timeout')
    response = client.get(f'/api/projects/{scenario.pid}/evaluation-jobs/{job["id"]}/judgments')
    assert SECRET not in response.text and len(scenario.calls) == 3
    assert all(r['status'] == 'ungraded' and r['tokens_charged'] == r['token_bound'] for r in response.json())
    assert all(r['result']['estimated_cost_usd'] > 0 for r in response.json())


def test_grading_window_does_not_restart_after_worker_recovery(client, scenario, monkeypatch):
    job, _ = scenario.submit(wall_seconds=5)
    class Crash(BaseException):
        pass
    def crash(self, content, timeout):
        scenario.calls.append((self.pinned['model_id'], content))
        raise Crash()
    monkeypatch.setattr(scenario.Judge, 'invoke', crash)
    with pytest.raises(Crash):
        execute(scenario, 'judge-window-crash')
    time.sleep(5.1)  # Simulate downtime longer than the persisted grading window.
    execute(scenario, 'judge-window-recovery')
    rows = client.get(f'/api/projects/{scenario.pid}/evaluation-jobs/{job["id"]}/judgments').json()
    assert len(scenario.calls) == 1
    assert sum(r['result']['reason'] == 'Judge time budget exhausted' for r in rows) == 2
