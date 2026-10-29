"""Real Postgres locks protect source writes before the embedding boundary.

Embedding adapters are stubbed: these tests make no paid provider requests.
"""

import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from workbench import db, ingest
from workbench.config import DEMO_PROJECT

pytestmark = pytest.mark.integration
BASE = f'/api/projects/{DEMO_PROJECT}'


def collection_path(client):
    response = client.post(BASE + '/collections', json={'name': 'Concurrency ' + db.uid()[:8]})
    assert response.status_code == 201
    return BASE + f'/collections/{response.json()["id"]}/sources'


def upload(client, path, data, name='policy.txt'):
    return client.post(path, files={'file': (name, data, 'text/plain')})


def test_overlapping_identical_uploads_stop_before_embedding_and_retry_reuses_version(
    client, monkeypatch
):
    path = collection_path(client)
    data = b'Quasar research documents are retained for thirty days.'
    entered, release = threading.Event(), threading.Event()
    calls = []

    def embed(passages, config):
        calls.append(config)
        entered.set()
        assert release.wait(15), 'Test did not release embedding boundary'
        return [None] * len(passages)

    monkeypatch.setattr(ingest, 'embed_passages', embed)
    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(upload, client, path, data)
        try:
            assert entered.wait(10), 'First upload did not reach embedding boundary'
            second = upload(client, path, data)
            assert second.status_code == 409
            assert 'already being prepared' in second.json()['detail']
            (source,) = client.get(path).json()
            assert source['status'] == 'processing' and source['error'] is None
            assert source['version_count'] == 0 and source['current_version_id'] is None
            assert len(calls) == 1
        finally:
            release.set()
        result = first.result(timeout=10)
    assert result.status_code == 201, result.text
    repeated = upload(client, path, data)
    assert repeated.status_code == 201 and repeated.json()['deduplicated']
    assert repeated.json()['version_id'] == result.json()['version_id']
    assert len(calls) == 1
    (source,) = client.get(path).json()
    assert source['status'] == 'ready' and source['error'] is None
    assert source['version_count'] == source['chunk_count'] == 1


def test_failed_replacement_preserves_version_and_releases_lock_for_explicit_retry(
    client, monkeypatch
):
    path = collection_path(client)
    original = upload(client, path, b'Quasar retention policy keeps immutable source evidence.')
    assert original.status_code == 201
    previous = original.json()['version_id']
    changed = b'Quasar replacement policy requires independent review.'
    entered, release = threading.Event(), threading.Event()
    calls = []

    def failing_embed(passages, config):
        calls.append(config)
        entered.set()
        assert release.wait(15), 'Test did not release embedding boundary'
        raise ingest.IngestionError(
            'Embedding provider is temporarily unavailable. Retry this file later.'
        )

    monkeypatch.setattr(ingest, 'embed_passages', failing_embed)
    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(upload, client, path, changed)
        try:
            assert entered.wait(10), 'Replacement did not reach embedding boundary'
            # Even malformed competing bytes cannot overwrite the active attempt's status.
            assert upload(client, path, b'\xff\xfe').status_code == 409
            (source,) = client.get(path).json()
            assert source['status'] == 'processing' and source['error'] is None
            assert source['current_version_id'] == previous and source['version_count'] == 1
            found = client.post(
                BASE + '/search',
                json={
                    'collection_id': source['collection_id'],
                    'query': 'quasar',
                    'method': 'keyword',
                },
            )
            assert found.status_code == 200
            assert found.json()[0]['chunk']['version_id'] == previous
            assert len(calls) == 1
        finally:
            release.set()
        assert first.result(timeout=10).status_code == 422
    (source,) = client.get(path).json()
    assert source['status'] == 'error' and 'temporarily unavailable' in source['error']
    assert source['current_version_id'] == previous and source['version_count'] == 1
    monkeypatch.setattr(ingest, 'embed_passages', lambda passages, _: [None] * len(passages))
    retry = upload(client, path, changed)
    assert retry.status_code == 201 and not retry.json()['deduplicated']
    (source,) = client.get(path).json()
    assert source['status'] == 'ready' and source['error'] is None
    assert source['current_version_id'] == retry.json()['version_id'] != previous
    assert source['version_count'] == 2


@pytest.mark.parametrize('same_collection', [True, False])
def test_unrelated_documents_can_embed_concurrently(client, monkeypatch, same_collection):
    first_path = collection_path(client)
    second_path = first_path if same_collection else collection_path(client)
    rendezvous = threading.Barrier(2, timeout=10)

    def embed(passages, config):
        rendezvous.wait()
        return [None] * len(passages)

    monkeypatch.setattr(ingest, 'embed_passages', embed)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(upload, client, first_path, b'Independent source policy one.')
        second = pool.submit(
            upload,
            client,
            second_path,
            b'Independent source policy two.',
            'other.txt' if same_collection else 'policy.txt',
        )
        for result in (first.result(timeout=15), second.result(timeout=15)):
            assert result.status_code == 201, result.text


def test_foreign_project_cannot_enter_source_write_boundary(client, monkeypatch):
    path = collection_path(client)

    def forbidden(*args):
        raise AssertionError('Foreign project reached ingestion')

    monkeypatch.setattr(ingest, '_document_lock', forbidden)
    foreign_path = path.replace(str(DEMO_PROJECT), db.uid())
    assert upload(client, foreign_path, b'Private source content.').status_code == 404
