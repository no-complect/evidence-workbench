"""Real API/queues/graphs/ledger; provider doubles never contact external services."""

from types import SimpleNamespace

import pytest
from test_evaluation_jobs import research_executor
from workbench import (
    collection_api,
    db,
    environment_models,
    evaluation_api,
    graph,
    harness,
    ingest,
    judge_policy,
    judging,
    project_api,
    retrieval,
    runs,
    worker,
)
from workbench.config import DEMO_USER, settings
from workbench.evaluation_worker import execute_job, lease
from workbench.model_targets import target_for
from workbench.models import EXAMPLES, Claim, Limits, RunCreate, SemanticJudgment
from workbench.providers import DemoProvider

pytestmark = pytest.mark.integration


def test_mixed_research_and_independent_anthropic_judge_are_pinned_and_scoped(client, monkeypatch):
    profile = settings().model_copy(
        update={
            'live_enabled': True,
            'openai_api_key': 'synthetic-openai-only',
            'anthropic_api_key': 'synthetic-anthropic-only',
            'openai_model': 'openai-research',
        }
    )
    for module in [
        collection_api,
        project_api,
        environment_models,
        evaluation_api,
        graph,
        runs,
        worker,
        judging,
    ]:
        monkeypatch.setattr(module, 'settings', lambda: profile)
    available = ['openai-research', 'anthropic:research-a', 'anthropic:judge-b']
    monkeypatch.setattr(environment_models, 'catalog', lambda *args: {'models': available})
    monkeypatch.setattr(
        ingest,
        'embed_passages',
        lambda passages, config, **kwargs: [[0.1] * 1536 for _ in passages],
    )
    monkeypatch.setattr(retrieval, 'query_vector', lambda *args: [0.1] * 1536)
    calls = []

    class OpenAI:
        name = 'openai'

        def __init__(self, target=None, api_key=None):
            self.target = target
            if target:
                assert api_key == profile.openai_api_key and target['provider'] == 'openai'

        def invoke(self, stage, payload, schema, timeout=35):
            calls.append(('openai', stage, self.target['model_id']))
            report, _, _ = DemoProvider().invoke(stage, payload, schema)
            if stage == 'report' and report.claims:
                for claim in report.claims:
                    claim.support = 'model_assessed'
                report.claims.append(
                    Claim(
                        text='Keep audit logs for seven days.',
                        evidence_ids=report.claims[0].evidence_ids,
                        support='model_assessed',
                    )
                )
            return report, 100, None

    class Anthropic(OpenAI):
        name = 'anthropic'

        def __init__(self, target, api_key):
            assert api_key == profile.anthropic_api_key and target['provider'] == 'anthropic'
            self.target = target

        def invoke(self, stage, payload, schema, timeout=35):
            result = super().invoke(stage, payload, schema, timeout)
            calls[-1] = ('anthropic', stage, self.target['model_id'])
            return result

    monkeypatch.setattr(graph, 'OpenAIProvider', OpenAI)
    monkeypatch.setattr(graph, 'AnthropicProvider', Anthropic)
    grades = []

    class Judge:
        def __init__(self, pinned, key):
            assert key == profile.anthropic_api_key and pinned['provider'] == 'anthropic'
            assert pinned['model_id'] == 'judge-b'

        def invoke(self, content, timeout):
            grades.append(content)
            return {
                'parsed': SemanticJudgment(
                    label='supported', reason='The passage states the rule.'
                ),
                'raw': SimpleNamespace(usage_metadata={'input_tokens': 11, 'output_tokens': 5}),
                'parsing_error': None,
            }

    monkeypatch.setattr(judge_policy, 'SemanticJudge', Judge)
    pid = client.post('/api/projects', json={'name': 'Mixed provider boundary'}).json()['id']
    cid = client.post(
        f'/api/projects/{pid}/collections',
        json={'name': 'Requirements', 'embedding_config': 'openai-small-v1'},
    ).json()['id']
    uploaded = client.post(
        f'/api/projects/{pid}/collections/{cid}/sources',
        files={
            'file': (
                'security.md',
                b'Security controls are required for the AI assistant. Keep audit logs for seven days. Access is restricted to authorized staff and reviewed regularly. Investigate security evidence and unresolved assumptions.',
                'text/markdown',
            )
        },
    )
    assert uploaded.status_code == 201
    body = {
        'split': 'development',
        'idempotency_key': db.uid(),
        'custom': {
            'collection_id': cid,
            'mode': 'live',
            'model_id': 'anthropic:research-a',
            'confirm_paid': True,
            'harness_config': {'stage_models': {'report': 'openai-research'}},
            'judge': {'model_id': 'anthropic:judge-b', 'max_claims_per_run': 1},
            'cases': [
                {
                    'question': EXAMPLES[1],
                    'query': 'security controls',
                    'expected_sources': ['security.md'],
                }
            ],
        },
    }
    endpoint = f'/api/projects/{pid}/evaluation-jobs'
    response = client.post(endpoint, json=body)
    assert response.status_code == 202, response.text
    saved = response.json()
    pinned = saved['request']['custom']['model_snapshot']
    assert pinned['targets']['plan']['provider'] == 'anthropic'
    assert pinned['targets']['plan']['model_id'] == 'research-a'
    assert pinned['targets']['report']['provider'] == 'openai'
    assert (
        saved['request']['custom']['judge_snapshot']['adapter'] == 'anthropic-structured-judge-v1'
    )
    assert calls == [] and grades == []
    assert profile.openai_api_key not in str(saved) and profile.anthropic_api_key not in str(saved)
    profile.openai_model, profile.anthropic_model = 'changed-openai', 'changed-anthropic'
    available.clear()  # A changing catalog/default must not retarget queued cases or retries.
    assert client.post(endpoint, json=body).json()['id'] == saved['id']
    with research_executor():
        job = lease('mixed-provider-test')
        assert str(job['project_id']) == pid
        execute_job(job)
    result = db.one('SELECT * FROM evaluation_runs WHERE id=%s', (job['id'],))
    assert result and all(row['status'] == 'completed' for row in result['raw'])
    assert {'anthropic', 'openai'} == {provider for provider, _, _ in calls}
    assert all(
        model == ('openai-research' if stage == 'report' else 'research-a')
        for _, stage, model in calls
    )
    assert len(grades) == 3
    assert all(
        row['judging']['judgments'][0]['request']['provider'] == 'anthropic'
        for row in result['raw']
    )
    assert all(row['judging']['judgments'][0]['tokens_charged'] == 16 for row in result['raw'])
    traces = db.all_rows('SELECT call_key,payload FROM contexts WHERE project_id=%s', (pid,))
    assert profile.openai_api_key not in str(traces) and profile.anthropic_api_key not in str(
        traces
    )
    assert (
        client.get(f'/api/projects/{db.uid()}/evaluation-jobs/{job["id"]}/judgments').status_code
        == 404
    )
    assert (
        db.one('SELECT count(*) AS n FROM provider_connections WHERE project_id=%s', (pid,))['n']
        == 0
    )
    # Pre-provider OpenAI snapshots retain their exact adapter/target shape and run.
    profile.openai_model = 'openai-research'
    old_target = target_for('openai-research', profile)
    old_target.pop('adapter')
    old = {
        **pinned,
        'fingerprints': harness.fingerprints(),
        'targets': {stage: old_target for stage in ['plan', 'assess', 'report']},
    }
    request = RunCreate(
        collection_id=cid,
        question=EXAMPLES[1],
        mode='live',
        strategy='workflow',
        approve_plan=False,
        idempotency_key=db.uid(),
        limits=Limits(),
    )
    previous = runs.create_run(pid, request, DEMO_USER, pinned_harness=old)
    for _ in range(50):
        queued = worker.lease('old-openai-snapshot')
        assert queued
        worker.execute_run(queued)
        if str(queued['id']) == str(previous['id']):
            break
    assert db.scoped_run(previous['id'], pid)['status'] == 'completed'
    # A provider revoked after enqueue must not silently fall back to the other key.
    available.extend(['openai-research', 'anthropic:research-a'])
    response = client.post(
        f'/api/projects/{pid}/runs',
        json={
            **request.model_dump(mode='json'),
            'idempotency_key': db.uid(),
            'model_id': 'anthropic:research-a',
        },
    )
    assert response.status_code == 202
    revoked_id = response.json()['id']
    profile.anthropic_api_key = ''
    before = len(calls)
    for _ in range(50):
        queued = worker.lease('revoked-anthropic')
        assert queued
        worker.execute_run(queued)
        if str(queued['id']) == revoked_id:
            break
    assert db.scoped_run(revoked_id, pid)['status'] == 'failed'
    assert len(calls) == before
