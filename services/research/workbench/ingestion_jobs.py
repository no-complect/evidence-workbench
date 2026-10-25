"""Durable source preparation intent. No model calls from submission or reads."""
import hashlib
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

from psycopg.errors import UniqueViolation

from . import db
from .auth import authorize
from .ingest import IngestionConflict, IngestionError
from .parsing import MAX_BYTES
from .storage import storage

PUBLIC_COLUMNS = 'id,collection_id,name,status,phase,error,result,retry_of,created_at,updated_at'


class NotFound(IngestionError):
    pass


def collection(project_id, collection_id, user):
    authorize(project_id, user)
    row = db.one('SELECT * FROM collections WHERE id=%s AND project_id=%s', (collection_id, project_id))
    if not row:
        raise NotFound('Collection not found')
    if row['read_only'] or row['setup_status'] != 'ready':
        raise IngestionConflict('Use a writable collection whose preparation is complete.')
    return row


def public(job_id, project_id):
    return db.one(f'SELECT {PUBLIC_COLUMNS} FROM ingestion_jobs WHERE id=%s AND project_id=%s',
                  (job_id, project_id))


def enqueue(project_id, collection_id, user, request_key, name, data):
    profile = collection(project_id, collection_id, user)['embedding_config']
    name = Path(name.replace('\\', '/')).name
    if not name or len(name) > 180 or any(ord(c) < 32 or ord(c) == 127 for c in name):
        raise IngestionError('Source filenames must contain 1–180 characters')
    if not data or len(data) > MAX_BYTES:
        raise IngestionError('Files must be nonempty and at most 8 MiB')
    if Path(name).suffix.lower() not in {'.txt', '.md', '.pdf'}:
        raise IngestionError('Supported formats: Markdown, plain text, text-based PDF')
    jid = str(uuid5(NAMESPACE_URL, f'ingestion/{project_id}/{user}/{request_key}'))
    did = str(uuid5(NAMESPACE_URL, f'{collection_id}/{name}'))
    digest = hashlib.sha256(data).hexdigest()
    vid = str(uuid5(NAMESPACE_URL, f'{did}/{digest}'))
    existing = db.one('SELECT * FROM ingestion_jobs WHERE id=%s AND project_id=%s', (jid, project_id))
    if existing:
        if str(existing['collection_id']) != str(collection_id) or str(existing['version_id']) != vid:
            raise IngestionConflict('This upload key belongs to a different file request.')
        return public(jid, project_id)
    if db.one("SELECT id FROM ingestion_jobs WHERE document_id=%s AND status IN ('queued','running')", (did,)):
        raise IngestionConflict('This source is already being prepared. Wait for that upload to finish, then retry this file.')
    key = f'{project_id}/{did}/{digest}'
    try:
        storage().put(key, data, 'application/pdf' if name.lower().endswith('.pdf') else 'text/plain')
    except Exception as exc:
        raise IngestionError('Source file could not be staged. Check server source storage, then retry this upload.') from exc
    try:
        db.execute('INSERT INTO ingestion_jobs(id,project_id,collection_id,document_id,version_id,name,content_hash,storage_key,embedding_config,created_by,request_key) '
                   'VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO NOTHING',
                   (jid, project_id, collection_id, did, vid, name, digest, key, profile, user, request_key))
    except UniqueViolation as exc:
        raise IngestionConflict('This source is already being prepared. Wait for that upload to finish, then retry this file.') from exc
    # A concurrent replay may have won the insert with a different request body.
    saved = db.one('SELECT version_id,collection_id FROM ingestion_jobs WHERE id=%s AND project_id=%s', (jid, project_id))
    if str(saved['version_id']) != vid or str(saved['collection_id']) != str(collection_id):
        raise IngestionConflict('This upload key belongs to a different file request.')
    return public(jid, project_id)


def retry(project_id, job_id, user):
    authorize(project_id, user)
    prior = db.one('SELECT * FROM ingestion_jobs WHERE id=%s AND project_id=%s', (job_id, project_id))
    if not prior:
        raise NotFound('File preparation not found')
    collection(project_id, prior['collection_id'], user)
    jid = str(uuid5(NAMESPACE_URL, f'ingestion-retry/{job_id}'))
    existing = public(jid, project_id)
    if existing:
        return existing
    if prior['status'] not in {'failed', 'cancelled'}:
        raise IngestionConflict('Only failed or cancelled file preparation can be retried.')
    try:
        db.execute('INSERT INTO ingestion_jobs(id,project_id,collection_id,document_id,version_id,name,content_hash,storage_key,embedding_config,created_by,request_key,retry_of) '
                   'VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO NOTHING',
                   (jid, project_id, prior['collection_id'], prior['document_id'], prior['version_id'],
                    prior['name'], prior['content_hash'], prior['storage_key'], prior['embedding_config'], user, jid, job_id))
    except UniqueViolation as exc:
        raise IngestionConflict('This source is already being prepared. Wait before retrying.') from exc
    return public(jid, project_id)
