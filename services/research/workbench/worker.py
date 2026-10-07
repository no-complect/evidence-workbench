"""Independent durable executor. Postgres leases schedule; LangGraph checkpoints resume."""
import logging
import signal
import threading
from contextlib import contextmanager
import httpx
import psycopg
from psycopg.rows import dict_row
from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.types import Command
from . import db
from .config import settings
from .graph import build_graph, partial_report
from .budget import BudgetExhausted, Cancelled, LeaseLost

log = logging.getLogger('workbench.worker')
STOP = threading.Event()


@contextmanager
def checkpoints():
    # Separate schema; session pooling/direct connection required, not transaction pooling.
    with psycopg.connect(settings().database_url,
                         autocommit=True,
                         prepare_threshold=0,
                         row_factory=dict_row,
                         options='-c search_path=graph_checkpoints,public,extensions') as conn:
        yield PostgresSaver(conn)


def setup_checkpoints():
    with db.connection() as guard:
        guard.execute('SELECT pg_advisory_xact_lock(817267)')
        with checkpoints() as saver:
            saver.setup()


def lease(owner):
    with db.connection() as conn:
        row = conn.execute(
            "SELECT * FROM research_runs WHERE ((status IN ('queued','retrying') AND available_at<=now()) OR (status='running' AND lease_until<now())) AND attempts<4 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1"
        ).fetchone()
        if not row:
            return None
        seconds = row['request']['limits']['wall_seconds']
        return conn.execute(
            "UPDATE research_runs SET status='running',lease_owner=%s,lease_until=now()+(%s * interval '1 second'),started_at=coalesce(started_at,now()),deadline=coalesce(deadline,now()+(%s * interval '1 second')),attempts=attempts+1,updated_at=now() WHERE id=%s RETURNING *",
            (owner, settings().lease_seconds, seconds, row['id'])).fetchone()


def heartbeat(run, done):
    while not done.wait(max(1, settings().lease_seconds / 3)):
        try:
            count = db.execute(
                "UPDATE research_runs SET lease_until=now()+(%s * interval '1 second') WHERE id=%s AND lease_owner=%s AND status='running'",
                (settings().lease_seconds, run['id'], run['lease_owner']))
            if not count:
                return
        except psycopg.Error:
            log.warning('Heartbeat unavailable; execution will stop when its lease expires')


def transient(exc):
    if isinstance(exc, (TimeoutError, ConnectionError, httpx.TimeoutException, httpx.NetworkError,
                        psycopg.OperationalError)):
        return True
    # Provider SDK errors expose HTTP status without needing to log credentials or payloads.
    return getattr(exc, 'status_code', None) in {408, 429, 500, 502, 503, 504}


def execute_run(run):
    # Session advisory lock prevents a stale worker and a lease recovery from running together.
    with psycopg.connect(settings().database_url, autocommit=True) as guard:
        locked = guard.execute('SELECT pg_try_advisory_lock(hashtextextended(%s,42))',
                               (str(run['id']), )).fetchone()[0]
        if not locked:
            db.execute(
                "UPDATE research_runs SET status='retrying',available_at=now()+interval '3 seconds',attempts=greatest(0,attempts-1) WHERE id=%s AND lease_owner=%s",
                (run['id'], run['lease_owner']))
            return
        done = threading.Event()
        thread = threading.Thread(target=heartbeat, args=(run, done), daemon=True)
        thread.start()
        try:
            db.event(run, f'lease/{run["attempts"]}', 'worker', 'Worker acquired durable job',
                     {'attempt': run['attempts']})
            with checkpoints() as saver:
                graph = build_graph(run, saver)
                config = {
                    'configurable': {
                        'thread_id': str(run['id'])
                    },
                    'max_concurrency': run['request']['limits']['concurrency'],
                    'recursion_limit': 70
                }
                snapshot = graph.get_state(config)
                if snapshot.tasks and any(t.interrupts for t in snapshot.tasks):
                    if not run.get('approved_plan'):
                        db.execute(
                            "UPDATE research_runs SET status='awaiting_approval' WHERE id=%s AND lease_owner=%s",
                            (run['id'], run['lease_owner']))
                        return
                    value = Command(resume=run['approved_plan'])
                elif snapshot.values:
                    value = None
                else:
                    value = {'run_id': str(run['id'])}
                result = graph.invoke(value, config)
                if result.get('__interrupt__'):
                    db.execute(
                        "UPDATE research_runs SET status='awaiting_approval',updated_at=now() WHERE id=%s AND lease_owner=%s",
                        (run['id'], run['lease_owner']))
                    db.event(run, 'awaiting', 'approve', 'Plan ready for your review')
        except Cancelled:
            db.execute(
                "UPDATE research_runs SET status='cancelled',updated_at=now() WHERE id=%s AND lease_owner=%s",
                (run['id'], run['lease_owner']))
            db.event(run, 'cancelled', 'cancel', 'Research cancelled; gathered evidence retained')
        except BudgetExhausted as exc:
            partial_report(run, str(exc))
        except LeaseLost:
            log.warning('Lease lost; checkpoint left for another worker')
        except Exception as exc:
            retry = transient(exc) and run['attempts'] < 4
            status = 'retrying' if retry else 'failed'
            error = f'Transient {type(exc).__name__}; retry scheduled' if retry else f'Execution failed ({type(exc).__name__}); inspect configuration and source validity'
            db.execute(
                "UPDATE research_runs SET status=%s,error=%s,available_at=now()+(%s*interval '1 second'),updated_at=now() WHERE id=%s AND lease_owner=%s",
                (status, error, 2**run['attempts'], run['id'], run['lease_owner']))
            db.event(run, f'error/{run["attempts"]}', 'retry' if retry else 'error', error)
            log.error('Run %s stopped with %s', run['id'], type(exc).__name__)
        finally:
            done.set()
            thread.join(timeout=2)
            db.execute(
                "UPDATE research_runs SET lease_until=CASE WHEN status='running' THEN now()-interval '1 second' ELSE NULL END,lease_owner=NULL WHERE id=%s AND lease_owner=%s",
                (run['id'], run['lease_owner']))


def main():
    logging.basicConfig(level=logging.INFO)
    db.migrate()
    setup_checkpoints()
    owner = db.uid()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: STOP.set())
    while not STOP.is_set():
        # Exhausted crash attempts must terminate rather than remain invisible in the queue.
        db.execute(
            "UPDATE research_runs SET status='failed',error='Recovery attempts exhausted' WHERE status='running' AND lease_until<now() AND attempts>=4"
        )
        run = lease(owner)
        if run:
            execute_run(run)
        else:
            STOP.wait(settings().poll_seconds)


if __name__ == '__main__':
    main()
