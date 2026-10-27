"""Authorized, retry-safe collection preparation. No provider calls for the starter pack."""
from uuid import NAMESPACE_URL, uuid5
from . import db
from .auth import authorize
from .config import ROOT, settings
from .ingest import MANIFEST, ingest, IngestionError
from .models import CollectionSetup


class SetupConflict(ValueError):
    pass


def options():
    s = settings()
    return {
        'documents': [{'name': meta['file'], 'bytes': (ROOT / 'fixtures/corpus' / meta['file']).stat().st_size}
                      for meta in MANIFEST['documents']],
        'live_embeddings': bool(s.live_enabled and s.openai_api_key
                                and s.openai_embedding_model == 'text-embedding-3-small'),
    }


def prepare(project_id, user, body: CollectionSetup):
    authorize(project_id, user)
    if body.source_kind == 'starter' and body.embedding_config != 'demo-v1':
        raise ValueError('The synthetic starter pack uses fixture vectors; no paid embeddings are created')
    if body.embedding_config == 'openai-small-v1' and not options()['live_embeddings']:
        raise SetupConflict('Live embeddings require a configured server profile and credentials')
    request = body.model_dump(mode='json', exclude={'idempotency_key'})
    cid = str(uuid5(NAMESPACE_URL, f'workbench-collection/{project_id}/{user}/{body.idempotency_key}'))
    with db.connection() as conn:
        conn.execute(
            'INSERT INTO collections(id,project_id,name,embedding_config,setup_request,setup_status) '
            'VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO NOTHING',
            (cid, project_id, body.name, body.embedding_config, db.jsonb(request),
             'preparing' if body.source_kind == 'starter' else 'ready'))
    collection = db.one('SELECT * FROM collections WHERE id=%s AND project_id=%s', (cid, project_id))
    if not collection or collection['setup_request'] != request:
        raise SetupConflict('This setup key belongs to another collection request')
    return resume(project_id, cid, user)


def resume(project_id, cid, user):
    authorize(project_id, user)
    # Serialize retries while ingestion commits independently. A completed setup
    # never re-seeds documents that the user may subsequently have replaced.
    with db.dedicated_connection() as lock:
        lock.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))', ('collection-setup/' + cid,))
        collection = db.one('SELECT * FROM collections WHERE id=%s AND project_id=%s', (cid, project_id))
        if not collection or not collection['setup_request'] or collection['read_only']:
            raise SetupConflict('This collection has no resumable preparation')
        if collection['setup_status'] != 'ready':
            if collection['embedding_config'] != 'demo-v1' or collection['setup_request']['source_kind'] != 'starter':
                raise SetupConflict('Only fixture starter preparation can be resumed')
            db.execute("UPDATE collections SET setup_status='preparing',setup_error=NULL WHERE id=%s", (cid,))
            try:
                for meta in MANIFEST['documents']:
                    path = ROOT / 'fixtures/corpus' / meta['file']
                    ingest(project_id, cid, path.name, path.read_bytes(), meta)
            except Exception as exc:
                message = str(exc) if isinstance(exc, IngestionError) else 'Starter preparation failed; retry to resume'
                db.execute("UPDATE collections SET setup_status='failed',setup_error=%s WHERE id=%s", (message, cid))
                raise IngestionError(message) from exc
            db.execute("UPDATE collections SET setup_status='ready',setup_error=NULL WHERE id=%s", (cid,))
    return db.one(
        'SELECT c.*,(SELECT count(*) FROM source_documents d WHERE d.collection_id=c.id) AS document_count '
        'FROM collections c WHERE c.id=%s AND c.project_id=%s', (cid, project_id))
