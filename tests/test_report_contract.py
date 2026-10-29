"""Native provider parsing and real queue regression, without external model calls."""

import hashlib
import importlib
import json

import anthropic
import httpx
import openai
import pytest
from pydantic import ValidationError
from workbench import harness, harness_api, providers
from workbench.citation_policy import validate_claims
from workbench.context import assemble
from workbench.models import Report, SynthesisReport

EID = '00000000-0000-4000-8000-000000000001'
PASSAGE = (
    'Arbor retains uploaded research documents for 30 days. Backup deletion timing is unspecified.'
)


def report_value(eid=EID, support='model_assessed'):
    return {
        'title': 'Retention review',
        'summary': 'Review the findings and limitations.',
        'claims': [
            {
                'text': 'Uploaded Arbor documents have a thirty-day retention period.',
                'evidence_ids': [eid],
                'support': support,
            }
        ],
        'limitations': ['Backup deletion timing is not established.'],
        'recommendations': [],
        'partial': False,
    }


def mock_provider_transport(monkeypatch, reply):
    observed = []
    original = httpx.Client.send

    def send(client, request, response_type, **kwargs):
        if request.url.host == 'testserver':
            return original(client, request, **kwargs)  # FastAPI's in-memory transport.
        assert request.url.host in {'api.openai.com', 'api.anthropic.com'}
        body = json.loads(request.content)
        observed.append(body)
        value = reply(body)
        if request.url.host == 'api.openai.com':
            response = {
                'id': 'chatcmpl-synthetic',
                'object': 'chat.completion',
                'created': 1,
                'model': body['model'],
                'choices': [
                    {
                        'index': 0,
                        'finish_reason': 'stop',
                        'message': {'role': 'assistant', 'content': json.dumps(value)},
                    }
                ],
                'usage': {'prompt_tokens': 30, 'completion_tokens': 20, 'total_tokens': 50},
            }
        else:
            response = {
                'id': 'msg_synthetic',
                'type': 'message',
                'role': 'assistant',
                'model': body['model'],
                'stop_reason': 'end_turn',
                'stop_sequence': None,
                'content': [{'type': 'text', 'text': json.dumps(value)}],
                'usage': {'input_tokens': 30, 'output_tokens': 20},
            }
        return response_type(200, json=response, request=request)

    # Isolate synthetic transports from host proxies; no request reaches a network.
    for name in [
        'HTTP_PROXY',
        'HTTPS_PROXY',
        'ALL_PROXY',
        'http_proxy',
        'https_proxy',
        'all_proxy',
    ]:
        monkeypatch.delenv(name, raising=False)
    for client_type in {httpx.Client, openai.DefaultHttpxClient, anthropic.DefaultHttpxClient}:
        base = next(base for base in client_type.__mro__ if base.__name__ == 'Client')
        transport = importlib.import_module(base.__module__.split('.')[0])

        def dispatch(client, request, _response=transport.Response, **kwargs):
            return send(client, request, _response, **kwargs)

        monkeypatch.setattr(client_type, 'send', dispatch)
    return observed


@pytest.mark.parametrize('provider', ['openai', 'anthropic'])
@pytest.mark.parametrize('support', ['model_assessed', 'direct_quote'])
def test_native_live_writer_contract_cannot_claim_direct_quotes(monkeypatch, provider, support):
    value = report_value(support=support)
    observed = mock_provider_transport(monkeypatch, lambda body: value)
    target = {
        'provider': provider,
        'model_id': 'synthetic-writer',
        'input_usd_per_million': None,
        'output_usd_per_million': None,
    }
    adapter = providers.OpenAIProvider if provider == 'openai' else providers.AnthropicProvider
    model = adapter(target, 'synthetic-provider-key-only')
    payload = {'trusted_instructions': 'Synthesize from cited evidence.', 'untrusted_sources': []}
    if support == 'direct_quote':
        with pytest.raises(providers.ModelCompatibilityError, match='schema validation'):
            model.invoke('report', payload, SynthesisReport)
    else:
        report, tokens, cost = model.invoke('report', payload, SynthesisReport)
        assert report == SynthesisReport.model_validate(value)
        assert tokens == 50 and cost is None
        assert report.claims[0].text not in PASSAGE
        assert validate_claims(report, [{'id': EID, 'text': PASSAGE, 'metadata': {}}])
    assert len(observed) == 1  # No hidden repair call or provider retry.
    body = observed[0]
    schema = (
        body['response_format']['json_schema']['schema']
        if provider == 'openai'
        else body['output_config']['format']['schema']
    )
    label = schema['$defs']['SynthesisClaim']['properties']['support']
    assert label.get('const') == 'model_assessed' or label.get('enum') == ['model_assessed']
    assert 'synthetic-provider-key-only' not in json.dumps(body)


def test_stored_quotes_remain_verbatim_and_citation_scope_is_not_relaxed():
    value = report_value(support='direct_quote')
    report = Report.model_validate(value)  # Older saved report remains readable.
    evidence = [{'id': EID, 'text': PASSAGE, 'metadata': {}}]
    with pytest.raises(ValueError, match='does not occur'):
        validate_claims(report, evidence)
    report.claims[0].text = 'Arbor retains uploaded research documents for 30 days.'
    assert validate_claims(report, evidence)
    synthesized = SynthesisReport.model_validate(report_value())
    with pytest.raises(ValueError, match='outside this run/project'):
        validate_claims(synthesized, [])
    with pytest.raises(ValueError, match='adversarial'):
        validate_claims(
            synthesized, [{**evidence[0], 'metadata': {'untrusted_instructions': True}}]
        )
    with pytest.raises(ValidationError):
        SynthesisReport.model_validate(value)


def test_studio_execution_prompt_and_fingerprint_share_the_live_contract(monkeypatch):
    monkeypatch.setattr(harness_api, 'authorize', lambda *args: None)
    studio = harness_api.studio('project', 'user')
    assert studio['schemas']['report'] == SynthesisReport.model_json_schema()
    assert 'ID: report-v3' in studio['prompts']['report']
    payload, trace = assemble('report', 'What retention applies?', [])
    assert payload['trusted_instructions'] == studio['prompts']['report']
    assert trace['prompt_id'] == 'report-v3'
    pinned = harness.fingerprints()
    assert pinned['prompts']['report'] == trace['prompt_hash']
    assert (
        pinned['contracts']['report']
        == hashlib.sha256(
            json.dumps(SynthesisReport.model_json_schema(), sort_keys=True).encode()
        ).hexdigest()
    )
    invalid = harness_api.validate_contract(
        'project',
        harness_api.ContractValidation(
            stage='report', payload=json.dumps(report_value(support='direct_quote'))
        ),
        'user',
    )
    assert invalid == {
        'valid': False,
        'errors': [{'path': 'claims.0.support', 'type': 'literal_error'}],
    }


@pytest.mark.integration
def test_live_paraphrase_survives_native_provider_queue_approval_and_citation_checks(
    client, monkeypatch
):
    from workbench import (
        collection_api,
        db,
        environment_models,
        graph,
        ingest,
        project_api,
        retrieval,
        runs,
        worker,
    )
    from workbench.config import settings

    profile = settings().model_copy(
        update={
            'live_enabled': True,
            'openai_api_key': 'synthetic-live-report-key',
            'openai_model': 'synthetic-writer',
        }
    )
    for module in [collection_api, project_api, environment_models, graph, runs]:
        monkeypatch.setattr(module, 'settings', lambda: profile)
    monkeypatch.setattr(
        environment_models, 'catalog', lambda *args: {'models': ['synthetic-writer']}
    )
    monkeypatch.setattr(
        ingest,
        'embed_passages',
        lambda passages, config, **kwargs: [[0.1] * 1536 for _ in passages],
    )
    monkeypatch.setattr(retrieval, 'query_vector', lambda *args: [0.1] * 1536)

    def reply(body):
        name = body['response_format']['json_schema']['name']
        if name == 'Plan':
            return {
                'tasks': [
                    {'id': 'retention', 'topic': 'retention', 'question': 'Arbor retention backups'}
                ],
                'rationale': 'Inspect the policy.',
            }
        if name == 'Assessment':
            return {
                'covered': ['retention'],
                'gaps': ['Backup timing unspecified'],
                'contradictions': [],
                'followups': [],
            }
        assert name == 'SynthesisReport'
        content = json.loads(body['messages'][1]['content'])
        return report_value(content['untrusted_sources'][0]['evidence_id'])

    observed = mock_provider_transport(monkeypatch, reply)
    pid = client.post('/api/projects', json={'name': 'Live report contract'}).json()['id']
    cid = client.post(
        f'/api/projects/{pid}/collections',
        json={'name': 'Retention policy', 'embedding_config': 'openai-small-v1'},
    ).json()['id']
    uploaded = client.post(
        f'/api/projects/{pid}/collections/{cid}/sources',
        files={'file': ('policy.txt', PASSAGE.encode(), 'text/plain')},
    )
    assert uploaded.status_code == 201
    response = client.post(
        f'/api/projects/{pid}/runs',
        json={
            'collection_id': cid,
            'question': 'What retention period does Arbor specify, and when are backups deleted?',
            'mode': 'live',
            'model_id': 'synthetic-writer',
            'strategy': 'workflow',
            'approve_plan': True,
            'idempotency_key': db.uid(),
        },
    )
    assert response.status_code == 202, response.text
    rid = response.json()['id']

    def execute():
        for _ in range(50):
            queued = worker.lease('live-report-contract')
            assert queued
            worker.execute_run(queued)
            if str(queued['id']) == rid:
                return db.scoped_run(rid, pid)
        pytest.fail('Expected research run was not leased')

    paused = execute()
    assert paused['status'] == 'awaiting_approval' and len(observed) == 1
    assert (
        client.post(f'/api/projects/{pid}/runs/{rid}/approve', json=paused['plan']).status_code
        == 202
    )
    completed = execute()
    assert completed['status'] == 'completed', completed['error']
    report = Report.model_validate(completed['report'])
    assert report.claims[0].support == 'model_assessed' and report.claims[0].text not in PASSAGE
    assert len(observed) == 3
    assert db.one('SELECT count(*) AS n FROM citations WHERE run_id=%s', (rid,))['n'] == 1
    context = db.one("SELECT payload FROM contexts WHERE run_id=%s AND stage='report'", (rid,))[
        'payload'
    ]
    assert context['prompt_id'] == 'report-v3' and len(context['selected']) == 1
    assert client.get(f'/api/projects/{pid}/runs/{rid}/report.md').status_code == 200
