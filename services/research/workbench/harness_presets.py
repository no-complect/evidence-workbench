"""Immutable reusable drafts. Saving does not discover, verify or invoke models."""
import hashlib
import json
from fastapi import HTTPException
from . import db
from .auth import authorize

MAX_PRESETS = 100
COLUMNS = 'id,name,settings,settings_hash,schema_version,created_at'


def list_presets(project, user):
    authorize(project, user)
    return db.serial(db.all_rows(
        f'SELECT {COLUMNS} FROM harness_presets WHERE project_id=%s AND user_id=%s '
        'ORDER BY created_at DESC,id DESC LIMIT %s', (project, user, MAX_PRESETS)))


def save_preset(project, user, body):
    authorize(project, user)
    settings = body.settings.model_dump(mode='json')
    digest = hashlib.sha256(json.dumps(settings, sort_keys=True, separators=(',', ':'),
                                      allow_nan=False).encode()).hexdigest()
    with db.connection() as conn:
        # Serialize saves for this owner: cap and idempotency checks share a transaction.
        conn.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))',
                     (f'harness-presets:{project}:{user}',))
        prior = conn.execute(f'SELECT {COLUMNS} FROM harness_presets WHERE project_id=%s '
                             'AND user_id=%s AND idempotency_key=%s',
                             (project, user, body.idempotency_key)).fetchone()
        if prior:
            if prior['name'] != body.name or prior['settings'] != settings:
                raise HTTPException(409, 'Preset retry key belongs to different settings')
            return db.serial(prior)
        count = conn.execute('SELECT count(*) AS n FROM harness_presets '
                             'WHERE project_id=%s AND user_id=%s', (project, user)).fetchone()['n']
        if count >= MAX_PRESETS:
            raise HTTPException(409, 'This project has reached the limit of 100 saved presets per user')
        row = conn.execute(
            'INSERT INTO harness_presets(id,project_id,user_id,name,settings,settings_hash,idempotency_key) '
            f'VALUES(%s,%s,%s,%s,%s,%s,%s) RETURNING {COLUMNS}',
            (db.uid(), project, user, body.name, db.jsonb(settings), digest, body.idempotency_key)).fetchone()
        return db.serial(row)
