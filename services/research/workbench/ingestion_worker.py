"""Independent durable file preparation. Ambiguous calls are never replayed automatically."""
import hashlib
import logging
import signal
import threading

import psycopg

from . import db
from .config import settings
from .ingest import (ingest, _document_lock, IngestionConflict, IngestionError,
                     IngestionCancelled, IngestionLeaseLost)
from .storage import storage

log = logging.getLogger('workbench.ingestion_worker')
STOP = threading.Event()


class Control:
    def __init__(self, job):
        self.job = job

    def owned(self, conn):
        row = conn.execute("SELECT * FROM ingestion_jobs WHERE id=%s AND project_id=%s AND status='running' "
                           'AND lease_owner=%s AND lease_until>clock_timestamp() FOR UPDATE',
                           (self.job['id'], self.job['project_id'], self.job['lease_owner'])).fetchone()
        if not row:
            raise IngestionLeaseLost()
        return row

    def stage(self, phase):
        with db.connection() as conn:
            if self.owned(conn)['cancel_requested']:
                raise IngestionCancelled()
            conn.execute('UPDATE ingestion_jobs SET phase=%s,updated_at=now() WHERE id=%s', (phase, self.job['id']))

    def finish(self, conn, result):
        if self.owned(conn)['cancel_requested']:
            raise IngestionCancelled()
        conn.execute("UPDATE ingestion_jobs SET status='ready',phase='finished',result=%s,error=NULL,"
                     'lease_owner=NULL,lease_until=NULL,updated_at=now() WHERE id=%s',
                     (db.jsonb(result), self.job['id']))

    def fail(self, conn, error):
        row = self.owned(conn)
        conn.execute("UPDATE ingestion_jobs SET status=%s,phase='finished',error=%s,lease_owner=NULL,"
                     'lease_until=NULL,updated_at=now() WHERE id=%s',
                     ('cancelled' if row['cancel_requested'] else 'failed', error, self.job['id']))


def lease(owner):
    with db.connection() as conn:
        row = conn.execute("SELECT id FROM ingestion_jobs WHERE status='queued' AND available_at<=now() "
                           'ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1').fetchone()
        if row:
            return conn.execute("UPDATE ingestion_jobs SET status='running',lease_owner=%s,"
                                "lease_until=now()+(%s*interval '1 second'),updated_at=now() WHERE id=%s RETURNING *",
                                (owner, settings().lease_seconds, row['id'])).fetchone()


def heartbeat(job, done):
    while not done.wait(max(1, settings().lease_seconds / 3)):
        try:
            if not db.execute("UPDATE ingestion_jobs SET lease_until=now()+(%s*interval '1 second') "
                              "WHERE id=%s AND lease_owner=%s AND status='running' AND lease_until>now()",
                              (settings().lease_seconds, job['id'], job['lease_owner'])):
                return
        except psycopg.Error:
            log.warning('Preparation heartbeat unavailable; expired ownership cannot publish')


def recover():
    # A live document guard also fences a slow executor whose heartbeat was lost.
    for job in db.all_rows("SELECT * FROM ingestion_jobs WHERE status='running' AND lease_until<now() LIMIT 40"):
        try:
            with _document_lock(str(job['document_id'])), db.connection() as conn:
                row = conn.execute("SELECT id FROM ingestion_jobs WHERE id=%s AND status='running' "
                                   'AND lease_until<now() FOR UPDATE', (job['id'],)).fetchone()
                if not row:
                    continue
                error = 'File preparation was interrupted. Retry explicitly; an earlier embedding request may have been charged.'
                conn.execute("UPDATE ingestion_jobs SET status=CASE WHEN cancel_requested THEN 'cancelled' ELSE 'failed' END,"
                             "phase='finished',error=%s,lease_owner=NULL,lease_until=NULL,updated_at=now() WHERE id=%s",
                             (error, job['id']))
                conn.execute("UPDATE source_documents SET status='error',error=%s WHERE id=%s AND project_id=%s AND status='processing'",
                             (error, job['document_id'], job['project_id']))
        except IngestionConflict:
            continue


def execute(job):
    control = Control(job)
    done = threading.Event()
    thread = threading.Thread(target=heartbeat, args=(job, done), daemon=True)
    thread.start()
    try:
        control.stage('reading')
        data = storage().get(job['storage_key'])
        if hashlib.sha256(data).hexdigest() != job['content_hash']:
            raise IngestionError('Staged source integrity check failed. Select the original file again.')
        ingest(job['project_id'], job['collection_id'], job['name'], data,
               {'synthetic': False, 'uploaded': True}, control=control)
    except IngestionConflict:
        # No provider call occurred: another synchronous writer still holds the guard.
        db.execute("UPDATE ingestion_jobs SET status='queued',phase='queued',lease_owner=NULL,lease_until=NULL,"
                   "available_at=now()+interval '3 seconds',updated_at=now() WHERE id=%s AND lease_owner=%s AND status='running' AND lease_until>now()",
                   (job['id'], job['lease_owner']))
    except IngestionLeaseLost:
        log.warning('Preparation ownership lost; recovery will expose the interruption')
    except Exception as exc:
        # Ingest persists its own safe outcome while holding the document guard.
        # This path also covers staging reads before that boundary.
        try:
            with db.connection() as conn:
                control.fail(conn, 'File preparation cancelled. An embedding request already in progress may still be charged.'
                             if isinstance(exc, IngestionCancelled) else str(exc) if isinstance(exc, IngestionError) else
                             'File preparation could not start. Check worker source storage, then retry.')
        except IngestionLeaseLost:
            pass
    finally:
        done.set()
        thread.join(timeout=2)


def main():
    logging.basicConfig(level=logging.INFO)
    db.migrate()
    owner = db.uid()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: STOP.set())
    while not STOP.is_set():
        try:
            recover()
            job = lease(owner)
            if job:
                execute(job)
            else:
                STOP.wait(settings().poll_seconds)
        except psycopg.Error:
            log.warning('Preparation database unavailable; queued jobs remain durable')
            STOP.wait(max(1, settings().poll_seconds))


if __name__ == '__main__':
    main()
