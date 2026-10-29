from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest
from openai import APIConnectionError, APIStatusError, APITimeoutError
from workbench import ingest


@pytest.fixture(autouse=True)
def document_guard(monkeypatch):
    # Provider/error tests have no database; real lock behavior is integration-tested.
    monkeypatch.setattr(ingest, '_document_lock', lambda _: nullcontext())


@pytest.mark.parametrize(
    'kind,status,code,expected',
    [
        ('status', 401, None, 'rejected the server credentials'),
        ('status', 403, None, 'denied model access'),
        ('status', 429, 'insufficient_quota', 'quota is exhausted'),
        ('status', 429, 'billing_hard_limit_reached', 'quota is exhausted'),
        ('status', 429, 'rate_limit_exceeded', 'rate limit reached'),
        ('status', 404, None, 'model is unavailable'),
        ('status', 400, None, 'request was rejected'),
        ('status', 503, None, 'temporarily unavailable'),
        ('timeout', None, None, 'request timed out'),
        ('connection', None, None, 'could not be reached'),
    ],
)
def test_embedding_failure_is_actionable_redacted_and_persisted_without_a_version(
    monkeypatch, kind, status, code, expected
):
    import langchain_openai

    private = 'private-source-and-provider-response-must-not-be-persisted'
    request = httpx.Request('POST', 'https://api.openai.com/v1/embeddings')
    if kind == 'timeout':
        failure = APITimeoutError(request=request)
    elif kind == 'connection':
        failure = APIConnectionError(message=private, request=request)
    else:
        failure = APIStatusError(
            private,
            response=httpx.Response(status, request=request),
            body={'code': code, 'message': private},
        )
    embedding_call = Mock(side_effect=failure)
    adapter = Mock(return_value=SimpleNamespace(embed_documents=embedding_call, client=Mock()))
    monkeypatch.setattr(langchain_openai, 'OpenAIEmbeddings', adapter)
    monkeypatch.setattr(
        ingest,
        'settings',
        lambda: SimpleNamespace(
            live_enabled=True,
            openai_api_key='synthetic-test-key',
            openai_embedding_model='text-embedding-3-small',
        ),
    )
    monkeypatch.setattr(
        ingest.db,
        'one',
        lambda query, args: (
            {'embedding_config': 'openai-small-v1'} if 'FROM collections' in query else None
        ),
    )
    execute = Mock()
    monkeypatch.setattr(ingest.db, 'execute', execute)
    store = Mock()
    monkeypatch.setattr(ingest, 'storage', store)

    with pytest.raises(ingest.IngestionError) as caught:
        ingest.ingest(
            'project', 'collection', 'policy.txt', b'Arbor retains documents for 30 days.'
        )

    message = str(caught.value)
    assert expected in message
    assert private not in message
    assert 'synthetic-test-key' not in message
    assert 'Arbor retains' not in message
    assert embedding_call.call_count == 1
    assert adapter.call_args.kwargs['max_retries'] == 0
    store.assert_not_called()
    query, parameters = execute.call_args.args
    assert "status='error'" in query
    assert 'current_version_id=' not in query
    assert parameters[0] == message
    assert private not in str(execute.call_args_list)


@pytest.mark.parametrize(
    'phase,expected',
    [
        ('reading', 'Source file could not be read'),
        ('embedding', 'Embedding preparation failed'),
        ('storage', 'Source file could not be stored'),
        ('indexing', 'Source passages could not be indexed'),
    ],
)
def test_unknown_ingestion_errors_report_only_the_failed_phase(monkeypatch, phase, expected):
    private = 'private-provider-storage-or-database-details'
    monkeypatch.setattr(
        ingest.db,
        'one',
        lambda query, args: (
            {'embedding_config': 'openai-small-v1'} if 'FROM collections' in query else None
        ),
    )
    execute = Mock()
    monkeypatch.setattr(ingest.db, 'execute', execute)
    monkeypatch.setattr(ingest, 'embed_passages', Mock(return_value=[None]))
    store = Mock()
    monkeypatch.setattr(ingest, 'storage', lambda: store)
    if phase == 'reading':
        monkeypatch.setattr(ingest, 'chunks_from_file', Mock(side_effect=RuntimeError(private)))
    elif phase == 'embedding':
        monkeypatch.setattr(ingest, 'embed_passages', Mock(side_effect=RuntimeError(private)))
    elif phase == 'storage':
        store.put.side_effect = RuntimeError(private)
    else:
        monkeypatch.setattr(ingest.db, 'connection', Mock(side_effect=RuntimeError(private)))
    with pytest.raises(ingest.IngestionError) as caught:
        ingest.ingest(
            'project', 'collection', 'policy.txt', b'Arbor retains documents for 30 days.'
        )
    assert expected in str(caught.value)
    assert private not in str(caught.value)
    query, parameters = execute.call_args.args
    assert "status='error'" in query
    assert 'current_version_id=' not in query
    assert parameters[0] == str(caught.value)
    assert private not in str(execute.call_args_list)
