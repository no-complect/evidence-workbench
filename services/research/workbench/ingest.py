import hashlib
import json
from contextlib import contextmanager
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5
import psycopg
from openai import APIError, APIConnectionError, APITimeoutError
from .config import ROOT, settings
from . import db
from .storage import storage
from .parsing import chunks_from_file, IngestionError, MAX_BYTES  # re-export for API/tests

MANIFEST = json.loads((ROOT / 'fixtures/manifest.json').read_text())


class IngestionConflict(IngestionError):
    pass


@contextmanager
def _document_lock(document_id):
    # A dedicated autocommit session holds the lock across provider/storage calls,
    # without leaving a database transaction open. Closing it releases the lock.
    with psycopg.connect(settings().database_url, autocommit=True, connect_timeout=5) as guard:
        if not guard.execute('SELECT pg_try_advisory_lock(hashtextextended(%s,0))',
                             (document_id,)).fetchone()[0]:
            raise IngestionConflict(
                'This source is already being prepared. Wait for that upload to finish, then retry this file.')
        yield


def _embedding_error(error: APIError) -> str:
    """Only fixed, actionable messages may leave the provider boundary."""
    status = getattr(error, 'status_code', None)
    if isinstance(error, APITimeoutError):
        return 'Embedding request timed out. Retry this file after checking provider availability.'
    if isinstance(error, APIConnectionError):
        return 'Embedding provider could not be reached. Check the API server network, then retry this file.'
    if status == 401:
        return 'Embedding provider rejected the server credentials. Correct OPENAI_API_KEY on the API and workers, restart them, then retry this file.'
    if status == 403:
        return 'Embedding provider denied model access. Check the API project permissions for text-embedding-3-small, then retry this file.'
    if status == 429:
        if getattr(error, 'code', None) in {'insufficient_quota', 'billing_hard_limit_reached'}:
            return 'Embedding provider quota is exhausted. Check the API project billing and usage limits before retrying this file.'
        return 'Embedding provider rate limit reached. Wait before retrying this file.'
    if status == 404:
        return 'Embedding model is unavailable. Check access to text-embedding-3-small before retrying this file.'
    if status is not None and status >= 500:
        return 'Embedding provider is temporarily unavailable. Retry this file later.'
    return 'Embedding request was rejected. Check the server embedding model and API project settings before retrying this file.'


def embed_passages(passages, config):
    if config == 'demo-v1':
        # Unseen uploads remain real full-text-searchable; never invent semantic vectors.
        return [
            MANIFEST['embeddings'].get(hashlib.sha256(p['text'].encode()).hexdigest())
            for p in passages
        ]
    s = settings()
    if not s.live_enabled or not s.openai_api_key:
        raise IngestionError('Live embedding requires explicit LIVE_ENABLED and server credentials')
    if s.openai_embedding_model != 'text-embedding-3-small':
        raise IngestionError(
            'This index requires text-embedding-3-small; create a new configuration to reindex')
    from langchain_openai import OpenAIEmbeddings
    try:
        return OpenAIEmbeddings(model=s.openai_embedding_model,
                                dimensions=1536,
                                chunk_size=32,
                                api_key=s.openai_api_key,
                                max_retries=0,
                                request_timeout=30).embed_documents([p['text'] for p in passages])
    except APIError as exc:
        raise IngestionError(_embedding_error(exc)) from exc


def ingest(project_id, collection_id, name, data, metadata=None, embed=True):
    name = Path(name.replace('\\', '/')).name
    if not name or len(name) > 180 or any(ord(char) < 32 or ord(char) == 127 for char in name):
        raise IngestionError('Source filenames must contain 1–180 characters')
    collection = db.one('SELECT * FROM collections WHERE id=%s AND project_id=%s',
                        (collection_id, project_id))
    if not collection:
        raise IngestionError('Collection not found in authorized project')
    document_id = str(uuid5(NAMESPACE_URL, f'{collection_id}/{name}'))
    digest = hashlib.sha256(data).hexdigest()
    version_id = str(uuid5(NAMESPACE_URL, f'{document_id}/{digest}'))
    # Serialize before deduplication and paid work, including failure persistence.
    # A competing upload must not overwrite the active source's status or error.
    with _document_lock(document_id):
        return _ingest_document(project_id, collection_id, name, data, metadata, embed,
                                collection, document_id, digest, version_id)


def _ingest_document(project_id, collection_id, name, data, metadata, embed,
                     collection, document_id, digest, version_id):
    db.execute(
        "INSERT INTO source_documents(id,project_id,collection_id,name,status) VALUES(%s,%s,%s,%s,'processing') ON CONFLICT(collection_id,name) DO NOTHING",
        (document_id, project_id, collection_id, name))
    existing = db.one('SELECT id FROM source_versions WHERE id=%s AND project_id=%s',
                      (version_id, project_id))
    if existing:
        db.execute(
            "UPDATE source_documents SET status='ready',error=NULL,current_version_id=%s WHERE id=%s AND project_id=%s",
            (version_id, document_id, project_id))
        return {
            'document_id': document_id,
            'version_id': version_id,
            'status': 'ready',
            'deduplicated': True
        }
    phase = 'reading'
    try:
        db.execute("UPDATE source_documents SET status='processing',error=NULL WHERE id=%s AND project_id=%s",
                   (document_id, project_id))
        passages = chunks_from_file(name, data)
        phase = 'embedding'
        vectors = embed_passages(
            passages, collection['embedding_config']) if embed else [None] * len(passages)
        media = 'application/pdf' if Path(name).suffix.lower() == '.pdf' else 'text/plain'
        key = f'{project_id}/{document_id}/{digest}'
        phase = 'storage'
        storage().put(key, data, media)
        phase = 'indexing'
        with db.connection() as conn:
            conn.execute(
                'INSERT INTO source_versions(id,project_id,document_id,content_hash,storage_key,media_type,metadata) VALUES(%s,%s,%s,%s,%s,%s,%s)',
                (version_id, project_id, document_id, digest, key, media, db.jsonb(metadata or {})))
            for i, (p, vector) in enumerate(zip(passages, vectors, strict=True)):
                cid = str(uuid5(NAMESPACE_URL, f'{version_id}/{i}'))
                conn.execute(
                    'INSERT INTO chunks(id,project_id,collection_id,version_id,ordinal,text,page,section,start_offset,end_offset,metadata,embedding_config,embedding) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::vector)',
                    (cid, project_id, collection_id, version_id, i, p['text'], p['page'],
                     p['section'], p['start_offset'], p['end_offset'], db.jsonb(metadata or {}),
                     collection['embedding_config'], json.dumps(vector) if vector else None))
            conn.execute(
                "UPDATE source_documents SET status='ready',error=NULL,current_version_id=%s WHERE id=%s",
                (version_id, document_id))
        return {
            'document_id': document_id,
            'version_id': version_id,
            'status': 'ready',
            'chunks': len(passages),
            'vector_chunks': sum(v is not None for v in vectors),
            'deduplicated': False
        }
    except Exception as exc:
        fallback = {
            'reading': 'Source file could not be read. Check its format and encoding before retrying this file.',
            'embedding': 'Embedding preparation failed. Check the API server embedding configuration and network access before retrying this file.',
            'storage': 'Source file could not be stored. Check server source storage availability and write permissions, then retry this file.',
            'indexing': 'Source passages could not be indexed. Check database availability and applied migrations, then retry this file.',
        }
        error = str(exc) if isinstance(exc, IngestionError) else fallback[phase]
        db.execute("UPDATE source_documents SET status='error',error=%s WHERE id=%s",
                   (error, document_id))
        raise IngestionError(error) from exc


__all__ = ['ingest', 'MANIFEST', 'MAX_BYTES', 'IngestionError', 'IngestionConflict',
           'chunks_from_file']
