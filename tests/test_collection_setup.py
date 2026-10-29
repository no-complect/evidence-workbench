"""Real collection setup, source failure recovery and retrieval boundaries."""

import concurrent.futures

import pytest
from psycopg.errors import CheckViolation
from workbench import db
from workbench.config import DEMO_PROJECT
from workbench.models import DEFAULT_QUESTION

pytestmark = pytest.mark.integration
BASE = f'/api/projects/{DEMO_PROJECT}'


def setup(client, source='starter'):
    body = {
        'name': 'Collection ' + db.uid()[:8],
        'purpose': 'security retention',
        'source_kind': source,
        'embedding_config': 'demo-v1',
        'idempotency_key': db.uid(),
    }
    response = client.post(BASE + '/collection-setups', json=body)
    assert response.status_code == 201, response.text
    return response.json(), body


def test_preparation_retries_reuse_versions_and_preserve_later_replacements(client):
    from workbench.ingest import MANIFEST

    collection, body = setup(client)
    cid = collection['id']
    assert collection['setup_status'] == 'ready'
    assert collection['document_count'] == len(MANIFEST['documents'])
    path = BASE + f'/collections/{cid}/sources'
    sources = client.get(path).json()
    assert all(s['chunk_count'] == s['vector_chunk_count'] > 0 for s in sources)
    name = sources[0]['name']
    changed = client.post(
        path, files={'file': (name, b'Security policy replacement requires review.', 'text/plain')}
    )
    assert changed.status_code == 201
    repeated = client.post(BASE + '/collection-setups', json=body)
    assert repeated.status_code == 201 and repeated.json()['id'] == cid
    current = next(s for s in client.get(path).json() if s['name'] == name)
    assert current['current_version_id'] == changed.json()['version_id']
    assert current['version_count'] == 2 and current['vector_chunk_count'] == 0
    assert current['chunk_count'] == 1
    assert (
        client.post(
            BASE + '/collection-setups', json={**body, 'purpose': 'a changed request'}
        ).status_code
        == 409
    )
    for column, value in [('embedding_config', 'openai-small-v1'), ('setup_request', db.jsonb({}))]:
        with pytest.raises(CheckViolation):
            db.execute(f'UPDATE collections SET {column}=%s WHERE id=%s', (value, cid))


def test_partial_preparation_is_blocked_then_resumes_without_duplicate_versions(
    client, monkeypatch
):
    from workbench import collection_setup
    from workbench.ingest import IngestionError

    original = collection_setup.ingest
    calls = 0

    def interrupted(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 3:
            raise IngestionError('Injected extraction failure')
        return original(*args, **kwargs)

    monkeypatch.setattr(collection_setup, 'ingest', interrupted)
    body = {
        'name': 'Interrupted ' + db.uid()[:8],
        'purpose': 'security retention',
        'source_kind': 'starter',
        'idempotency_key': db.uid(),
    }
    response = client.post(BASE + '/collection-setups', json=body)
    assert response.status_code == 422
    collection = next(
        c for c in client.get(BASE).json()['collections'] if c['name'] == body['name']
    )
    cid = collection['id']
    assert collection['setup_status'] == 'failed' and collection['document_count'] == 2
    assert (
        client.post(BASE + '/search', json={'collection_id': cid, 'query': 'security'}).status_code
        == 422
    )
    assert (
        client.post(
            BASE + '/runs',
            json={'collection_id': cid, 'question': DEFAULT_QUESTION, 'idempotency_key': db.uid()},
        ).status_code
        == 409
    )
    assert (
        client.post(
            BASE + f'/collections/{cid}/sources',
            files={'file': ('new.txt', b'policy', 'text/plain')},
        ).status_code
        == 409
    )
    monkeypatch.setattr(collection_setup, 'ingest', original)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(lambda _: client.post(BASE + f'/collections/{cid}/prepare'), range(2))
        )
    assert all(r.status_code == 200 for r in results)
    sources = client.get(BASE + f'/collections/{cid}/sources').json()
    assert len(sources) == len(collection_setup.MANIFEST['documents'])
    assert all(s['version_count'] == 1 for s in sources)


def test_upload_errors_preserve_current_source_and_exact_retry_is_deduplicated(client):
    collection, _ = setup(client, 'upload')
    path = BASE + f'/collections/{collection["id"]}/sources'
    data = b'Quasar archival policy requires immutable source evidence.'
    first = client.post(path, files={'file': ('policy.txt', data, 'text/plain')}).json()
    for name, content in [
        ('policy.txt', b'\xff\xfe'),
        ('empty.txt', b''),
        ('bad.pdf', b'invalid'),
        ('wrong.csv', b'no'),
        ('large.txt', b'x' * (8 * 1024 * 1024 + 1)),
    ]:
        assert (
            client.post(
                path, files={'file': (name, content, 'application/octet-stream')}
            ).status_code
            == 422
        )
    current = next(s for s in client.get(path).json() if s['name'] == 'policy.txt')
    assert current['status'] == 'error' and current['current_version_id'] == first['version_id']
    assert (
        current['version_count'] == current['chunk_count'] == 1
        and current['vector_chunk_count'] == 0
    )
    found = client.post(
        BASE + '/search',
        json={'collection_id': collection['id'], 'query': 'quasar', 'method': 'keyword'},
    )
    assert (
        found.status_code == 200 and found.json()[0]['chunk']['version_id'] == first['version_id']
    )
    repeated = client.post(path, files={'file': ('policy.txt', data, 'text/plain')}).json()
    assert repeated['deduplicated'] and repeated['version_id'] == first['version_id']


def test_retrieval_methods_do_not_silently_call_models_for_keyword(client, monkeypatch):
    from workbench import retrieval

    collection, _ = setup(client)

    def forbidden(*args):
        raise AssertionError('Keyword retrieval must not embed the query')

    original = retrieval.query_vector
    monkeypatch.setattr(retrieval, 'query_vector', forbidden)
    payload = {'collection_id': collection['id'], 'query': 'security retention'}
    hits = client.post(BASE + '/search', json={**payload, 'method': 'keyword'}).json()
    assert hits and all(set(h['ranks']) == {'full_text'} for h in hits)
    monkeypatch.setattr(retrieval, 'query_vector', original)
    hits = client.post(BASE + '/search', json={**payload, 'method': 'vector'}).json()
    assert hits and all(set(h['ranks']) == {'vector'} for h in hits)
    assert all(len(h['chunk']['content_hash']) == 64 for h in hits)
    hits = client.post(BASE + '/search', json={**payload, 'method': 'hybrid'}).json()
    assert any(set(h['ranks']) == {'full_text', 'vector'} for h in hits)
    assert (
        client.post(
            BASE + '/search', json={**payload, 'query': 'quasar', 'method': 'vector'}
        ).status_code
        == 422
    )
    assert client.post(BASE + '/search', json={**payload, 'query': '   '}).status_code == 422


def test_setup_options_scope_and_profile_validation(client):
    from workbench.ingest import MANIFEST

    options = client.get(BASE + '/collection-options').json()
    assert (
        len(options['documents']) == len(MANIFEST['documents']) and not options['live_embeddings']
    )
    foreign = db.uid()
    assert client.get(f'/api/projects/{foreign}/collection-options').status_code == 404
    collection, body = setup(client, 'upload')
    assert client.post(f'/api/projects/{foreign}/collection-setups', json=body).status_code == 404
    assert (
        client.post(f'/api/projects/{foreign}/collections/{collection["id"]}/prepare').status_code
        == 404
    )
    assert client.get(BASE + f'/collections/{db.uid()}/sources').status_code == 404
    assert (
        client.post(
            BASE + '/collection-setups',
            json={**body, 'idempotency_key': db.uid(), 'embedding_config': 'openai-small-v1'},
        ).status_code
        == 409
    )
    assert (
        client.post(
            BASE + '/collection-setups',
            json={
                **body,
                'idempotency_key': db.uid(),
                'source_kind': 'starter',
                'embedding_config': 'openai-small-v1',
            },
        ).status_code
        == 422
    )
