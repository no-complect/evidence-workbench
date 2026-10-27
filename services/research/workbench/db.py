from contextlib import contextmanager
from uuid import uuid4
import json
import psycopg
from psycopg_pool import ConnectionPool
from threading import Lock
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from .config import ROOT, settings
from .context import redact

_pool = None
_pool_users = 0
_pool_lock = Lock()


def connection_options():
    return {'row_factory': dict_row, 'connect_timeout': 5,
            'options': '-c search_path=public,extensions -c statement_timeout=30000'}


@contextmanager
def pooled_connections():
    """One bounded query pool per process, owned by API/worker lifecycles."""
    global _pool, _pool_users
    with _pool_lock:
        if _pool is None:
            _pool = ConnectionPool(settings().database_url, kwargs=connection_options(),
                                   min_size=0, max_size=settings().db_pool_max_size, timeout=5, open=False,
                                   name='workbench-db')
            _pool.open()
        pool = _pool
        _pool_users += 1
    try:
        yield pool
    finally:
        with _pool_lock:
            _pool_users -= 1
            close = _pool_users == 0
            if close:
                _pool = None
        if close:
            pool.close()


@contextmanager
def dedicated_connection():
    """Session/transaction locks that span nested queries cannot borrow from the query pool."""
    with psycopg.connect(settings().database_url, **connection_options()) as conn:
        yield conn


def uid():
    return str(uuid4())


def serial(value):
    return json.loads(json.dumps(value, default=str))


@contextmanager
def connection():
    pool = _pool
    manager = pool.connection() if pool is not None else dedicated_connection()
    with manager as conn:
        yield conn


def one(sql, args=()):
    with connection() as conn:
        return conn.execute(sql, args).fetchone()


def all_rows(sql, args=()):
    with connection() as conn:
        return conn.execute(sql, args).fetchall()


def execute(sql, args=()):
    with connection() as conn:
        return conn.execute(sql, args).rowcount


def jsonb(value):
    return Jsonb(serial(value))


def migrate():
    with connection() as conn:
        conn.execute('SELECT pg_advisory_xact_lock(817266)')
        conn.execute(
            'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())'
        )
        for path in sorted((ROOT / 'db/migrations').glob('*.sql')):
            if conn.execute('SELECT 1 FROM schema_migrations WHERE version=%s',
                            (path.name, )).fetchone():
                continue
            if 'supabase' in path.name and not conn.execute(
                    "SELECT 1 FROM pg_namespace WHERE nspname='auth'").fetchone():
                continue
            conn.execute(path.read_text())
            conn.execute('INSERT INTO schema_migrations(version) VALUES(%s)', (path.name, ))
        conn.execute('CREATE SCHEMA IF NOT EXISTS graph_checkpoints')
        conn.execute('REVOKE ALL ON SCHEMA graph_checkpoints FROM PUBLIC')


def event(run, key, stage, message, data=None):
    execute(
        'INSERT INTO run_events(run_id,project_id,event_key,stage,message,data) VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT(run_id,event_key) DO NOTHING',
        (run['id'], run['project_id'], key, stage, redact(
            {'message': message})['message'], jsonb(redact(data or {}))))


def scoped_run(run_id, project_id):
    row = one('SELECT * FROM research_runs WHERE id=%s AND project_id=%s', (run_id, project_id))
    if not row:
        raise ValueError('Run not found in authorized project')
    return row
