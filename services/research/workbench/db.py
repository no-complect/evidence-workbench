from contextlib import contextmanager
from uuid import uuid4
import json
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from .config import ROOT, settings
from .context import redact


def uid():
    return str(uuid4())


def serial(value):
    return json.loads(json.dumps(value, default=str))


@contextmanager
def connection():
    with psycopg.connect(
            settings().database_url,
            row_factory=dict_row,
            connect_timeout=5,
            options='-c search_path=public,extensions -c statement_timeout=30000') as conn:
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
