"""Durable benchmark coordinator; research workers execute its individual runs."""
import logging
import signal
import threading
import psycopg
from . import db
from .config import settings
from .evaluate import run_evaluation
from .evaluation_api import benchmark_versions

log = logging.getLogger('workbench.evaluation_worker')
STOP = threading.Event()


class EvaluationStopped(Exception):
    pass


class EvaluationLeaseLost(Exception):
    pass


def lease(owner):
    with db.connection() as conn:
        row = conn.execute(
            "SELECT * FROM evaluation_jobs WHERE (status='queued' OR "
            "(status='running' AND lease_until<now())) AND attempts<3 "
            "ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1").fetchone()
        if not row:
            return None
        return conn.execute(
            "UPDATE evaluation_jobs SET status='running',lease_owner=%s,"
            "lease_until=now()+(%s * interval '1 second'),attempts=attempts+1,updated_at=now() "
            'WHERE id=%s RETURNING *', (owner, settings().lease_seconds, row['id'])).fetchone()


def guard(job):
    if STOP.is_set():
        raise EvaluationLeaseLost()
    row = db.one(
        'SELECT cancel_requested,lease_until>now() AS leased FROM evaluation_jobs '
        "WHERE id=%s AND lease_owner=%s AND status='running'", (job['id'], job['lease_owner']))
    if not row or not row['leased']:
        raise EvaluationLeaseLost()
    if row['cancel_requested']:
        raise EvaluationStopped()


def heartbeat(job, done):
    while not done.wait(max(1, settings().lease_seconds / 3)):
        try:
            if not db.execute(
                "UPDATE evaluation_jobs SET lease_until=now()+(%s * interval '1 second') "
                "WHERE id=%s AND lease_owner=%s AND status='running' AND lease_until>now()",
                (settings().lease_seconds, job['id'], job['lease_owner'])):
                return
        except psycopg.Error:
            log.warning('Evaluation heartbeat unavailable')
            return


def stop_children(job):
    db.execute(
        "UPDATE research_runs SET cancel_requested=true,status=CASE WHEN status IN "
        "('queued','retrying','awaiting_approval') THEN 'cancelled' ELSE status END,updated_at=now() "
        "WHERE evaluation_job_id=%s AND project_id=%s "
        "AND status NOT IN ('completed','failed','partial','cancelled')",
        (job['id'], job['project_id']))


def execute_job(job):
    # A session lock also fences a slow worker whose lease expired during a DB outage.
    with psycopg.connect(settings().database_url, autocommit=True) as lock:
        if not lock.execute('SELECT pg_try_advisory_lock(hashtextextended(%s,43))',
                            (str(job['id']),)).fetchone()[0]:
            db.execute(
                "UPDATE evaluation_jobs SET status='queued',lease_owner=NULL,lease_until=NULL,"
                'attempts=greatest(0,attempts-1) WHERE id=%s AND lease_owner=%s',
                (job['id'], job['lease_owner']))
            return
        done = threading.Event()
        thread = threading.Thread(target=heartbeat, args=(job, done), daemon=True)
        thread.start()

        def progress(value):
            guard(job)
            db.execute(
                'UPDATE evaluation_jobs SET progress=%s,updated_at=now() '
                'WHERE id=%s AND lease_owner=%s AND lease_until>now()',
                (db.jsonb(value), job['id'], job['lease_owner']))

        try:
            guard(job)
            if any(job['request'].get(key) != value
                   for key, value in benchmark_versions().items()):
                raise ValueError('Benchmark changed after submission; queue a new evaluation')
            result_id = run_evaluation(
                job['request']['split'], project_id=job['project_id'], user_id=job['user_id'],
                evaluation_id=str(job['id']), collection_id=str(job['collection_id']),
                progress=progress, check_active=lambda: guard(job), custom=job['request'].get('custom'))
            guard(job)
            updated = db.execute(
                "UPDATE evaluation_jobs SET status='completed',result_id=%s,updated_at=now() "
                'WHERE id=%s AND lease_owner=%s AND NOT cancel_requested AND lease_until>now()',
                (result_id, job['id'], job['lease_owner']))
            if not updated:
                guard(job)
        except EvaluationStopped:
            stop_children(job)
            db.execute(
                "UPDATE evaluation_jobs SET status='cancelled',updated_at=now() "
                'WHERE id=%s AND lease_owner=%s', (job['id'], job['lease_owner']))
        except EvaluationLeaseLost:
            log.info('Evaluation lease released; another worker can recover saved runs')
        except Exception as exc:
            guard(job)
            stop_children(job)
            db.execute(
                "UPDATE evaluation_jobs SET status='failed',error=%s,updated_at=now() "
                'WHERE id=%s AND lease_owner=%s AND lease_until>now()',
                (f'Evaluation stopped ({type(exc).__name__}). Check worker availability and '
                 'benchmark versions, then queue a new evaluation.', job['id'], job['lease_owner']))
            log.error('Evaluation %s stopped with %s', job['id'], type(exc).__name__)
        finally:
            done.set()
            thread.join(timeout=2)
            db.execute(
                "UPDATE evaluation_jobs SET lease_until=CASE WHEN status='running' "
                "THEN now()-interval '1 second' ELSE NULL END,lease_owner=NULL "
                'WHERE id=%s AND lease_owner=%s', (job['id'], job['lease_owner']))


def main():
    logging.basicConfig(level=logging.INFO)
    db.migrate()
    owner = db.uid()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: STOP.set())
    while not STOP.is_set():
        exhausted = db.all_rows(
            "UPDATE evaluation_jobs SET status='failed',error='Recovery attempts exhausted',"
            "updated_at=now() WHERE status='running' AND lease_until<now() AND attempts>=3 "
            'RETURNING id,project_id')
        for job in exhausted:
            stop_children(job)
        job = lease(owner)
        if job:
            execute_job(job)
        else:
            STOP.wait(settings().poll_seconds)


if __name__ == '__main__':
    main()
