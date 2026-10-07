import hashlib
import json
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5
from .config import ROOT, settings
from . import db
from .storage import storage
from .parsing import chunks_from_file, IngestionError, MAX_BYTES  # re-export for API/tests

MANIFEST = json.loads((ROOT / 'fixtures/manifest.json').read_text())


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
    return OpenAIEmbeddings(model=s.openai_embedding_model,
                            dimensions=1536,
                            chunk_size=32,
                            api_key=s.openai_api_key,
                            max_retries=0,
                            request_timeout=30).embed_documents([p['text'] for p in passages])


def ingest(project_id, collection_id, name, data, metadata=None, embed=True):
    name = Path(name).name[:180]
    collection = db.one('SELECT * FROM collections WHERE id=%s AND project_id=%s',
                        (collection_id, project_id))
    if not collection:
        raise IngestionError('Collection not found in authorized project')
    document_id = str(uuid5(NAMESPACE_URL, f'{collection_id}/{name}'))
    digest = hashlib.sha256(data).hexdigest()
    version_id = str(uuid5(NAMESPACE_URL, f'{document_id}/{digest}'))
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
    try:
        passages = chunks_from_file(name, data)
        vectors = embed_passages(
            passages, collection['embedding_config']) if embed else [None] * len(passages)
        media = 'application/pdf' if Path(name).suffix.lower() == '.pdf' else 'text/plain'
        key = f'{project_id}/{document_id}/{digest}'
        storage().put(key, data, media)
        with db.connection() as conn:
            conn.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))', (document_id, ))
            if conn.execute('SELECT id FROM source_versions WHERE id=%s',
                            (version_id, )).fetchone():
                conn.execute(
                    "UPDATE source_documents SET status='ready',error=NULL,current_version_id=%s WHERE id=%s AND project_id=%s",
                    (version_id, document_id, project_id))
                return {
                    'document_id': document_id,
                    'version_id': version_id,
                    'status': 'ready',
                    'deduplicated': True
                }
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
        error = str(exc) if isinstance(
            exc, IngestionError) else 'Ingestion failed; check adapter configuration'
        db.execute("UPDATE source_documents SET status='error',error=%s WHERE id=%s",
                   (error, document_id))
        raise IngestionError(error) from exc


__all__ = ['ingest', 'MANIFEST', 'MAX_BYTES', 'IngestionError', 'chunks_from_file']
