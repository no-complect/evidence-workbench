"""Local provider boundary, explicit capability checks and immutable revisions."""
import hashlib
import json
import re
from fastapi import HTTPException
import httpx
from . import db
from .auth import authorize
from .config import ROOT, settings
from .context import POLICY, CAPS
from .credential_store import encrypt, decrypt
from .models import Plan, Assessment, Report
from .providers import OpenAIProvider

SCHEMAS = {'plan': Plan, 'assess': Assessment, 'report': Report}
CONNECTION_COLUMNS = 'id,project_id,name,provider,active,catalog,discovered_at,created_at'


def local_enabled():
    s = settings()
    return s.app_env in {'local', 'test'} and s.auth_mode == 'demo'


def guard(project, user):
    authorize(project, user)
    if not local_enabled():
        raise HTTPException(403, 'Provider management is available only in a trusted local installation')


def fingerprints():
    def digest(value):
        return hashlib.sha256(value).hexdigest()
    return {
        'adapter': 'openai-json-schema-v1', 'context_policy': POLICY, 'context_caps': CAPS,
        'output_token_cap': 2200, 'tool_policy': 'scoped-retrieval-opt-in-web-v1',
        'prompts': {stage: digest((ROOT / 'prompts' / f'{stage}-v1.md').read_bytes()) for stage in SCHEMAS},
        'contracts': {stage: digest(json.dumps(schema.model_json_schema(), sort_keys=True).encode())
                      for stage, schema in SCHEMAS.items()},
    }


def connection(project, cid, user=None):
    row = db.one('SELECT * FROM provider_connections WHERE id=%s AND project_id=%s', (cid, project))
    if not row or (user is not None and str(row['user_id']) != str(user)):
        raise HTTPException(404, 'Provider connection not found')
    if not row['active'] or not row['encrypted_key']:
        raise HTTPException(409, 'Provider disconnected; reconnect and save a new revision')
    return row


def create_connection(project, user, body):
    guard(project, user)
    if db.one('SELECT count(*) AS n FROM provider_connections WHERE project_id=%s AND active', (project,))['n'] >= 20:
        raise HTTPException(409, 'Disconnect an unused provider before adding another')
    key = settings().openai_api_key if body.use_environment else body.api_key.get_secret_value()
    if not key:
        raise HTTPException(409, 'No server OpenAI key is configured')
    encrypted = encrypt(key)
    cid = db.uid()
    db.execute('INSERT INTO provider_connections(id,project_id,user_id,name,provider,encrypted_key) '
               "VALUES(%s,%s,%s,%s,'openai',%s)", (cid, project, user, body.name, encrypted))
    return db.one(f'SELECT {CONNECTION_COLUMNS} FROM provider_connections WHERE id=%s', (cid,))


def discover(project, cid, user):
    guard(project, user)
    row = connection(project, cid, user)
    try:
        with httpx.Client(timeout=15, follow_redirects=False, trust_env=False) as client:
            result = client.get('https://api.openai.com/v1/models',
                                headers={'Authorization': 'Bearer ' + decrypt(row['encrypted_key'])})
            result.raise_for_status()
            data = result.json()['data']
            if not isinstance(data, list) or len(data) > 2000:
                raise ValueError('Invalid catalog')
            models = sorted({item['id'] for item in data if isinstance(item, dict)
                             and isinstance(item.get('id'), str)
                             and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}', item['id'])})
    except Exception:
        # Never reflect provider responses, request headers or credentials.
        raise HTTPException(502, 'Model discovery failed; check provider access and connectivity') from None
    db.execute('UPDATE provider_connections SET catalog=%s,discovered_at=now() WHERE id=%s AND active',
               (db.jsonb(models), cid))
    return models


def disconnect(project, cid, user):
    guard(project, user)
    # Idempotent revocation. Immutable revisions retain safe model identity only.
    db.execute('UPDATE provider_connections SET active=false,encrypted_key=NULL,catalog=\'[]\' '
               'WHERE id=%s AND project_id=%s AND user_id=%s', (cid, project, user))


def check_cost(body):
    input_bound = sum(len(json.dumps(schema.model_json_schema()).encode()) + 1024 for schema in SCHEMAS.values())
    return (input_bound * body.input_usd_per_million + 3 * 2200 * body.output_usd_per_million) / 1_000_000


def verify_model(project, cid, user, body):
    guard(project, user)
    row = connection(project, cid, user)
    request = {**body.model_dump(mode='json', exclude={'idempotency_key'}), 'connection_id': str(cid),
               'fingerprints': fingerprints()}
    prior = db.one('SELECT * FROM provider_verifications WHERE project_id=%s AND user_id=%s AND idempotency_key=%s',
                   (project, user, body.idempotency_key))
    if prior:
        if prior['request'] != request:
            raise HTTPException(409, 'Verification key belongs to another request')
        return prior
    if not settings().live_enabled:
        raise HTTPException(409, 'Enable live calls on the server before running paid capability checks')
    if body.model_id not in row['catalog']:
        raise HTTPException(409, 'Discover this model with this connection before verifying it')
    estimated = check_cost(body)
    if estimated > body.max_cost_usd:
        raise HTTPException(409, 'The conservative probe estimate exceeds this verification budget')
    vid = db.uid()
    reserved = db.one('INSERT INTO provider_verifications(id,project_id,connection_id,user_id,request,idempotency_key,status,estimated_cost) '
                      "VALUES(%s,%s,%s,%s,%s,%s,'checking',%s) ON CONFLICT(project_id,user_id,idempotency_key) DO NOTHING RETURNING *",
                      (vid, project, cid, user, db.jsonb(request), body.idempotency_key, estimated))
    if not reserved:
        # Another identical request owns the side effect; never replay a probe.
        prior = db.one('SELECT * FROM provider_verifications WHERE project_id=%s AND user_id=%s AND idempotency_key=%s',
                       (project, user, body.idempotency_key))
        if prior['request'] != request:
            raise HTTPException(409, 'Verification key belongs to another request')
        return prior
    cost, known = 0.0, True
    try:
        for stage, schema in SCHEMAS.items():
            # Recheck revocation and live enablement before every external call.
            if not settings().live_enabled:
                raise ValueError('Live calls disabled')
            current = connection(project, cid, user)
            provider = OpenAIProvider(request, decrypt(current['encrypted_key']))
            payload = {'trusted_instructions': 'Return a minimal valid object matching the supplied research schema. '
                       'Use a single task with id probe and topic security for plans; empty lists where allowed. '
                       'Use no citations or claims. This is a synthetic capability check, not research.',
                       'user_requirements': 'Verify structured output compatibility.',
                       'durable_summary': {}, 'untrusted_sources': []}
            result, _, actual_cost = provider.invoke(stage, payload, schema, timeout=8)
            schema.model_validate(result)
            if actual_cost is None:
                known = False
            else:
                cost += actual_cost
            if cost > body.max_cost_usd:
                raise ValueError('Reported usage exceeded the verification estimate')
        status, error = 'verified', None
    except Exception as exc:
        known = False
        status = 'failed' if isinstance(exc, (ValueError, HTTPException)) or getattr(exc, 'status_code', None) else 'uncertain'
        error = ('The research contract checks did not complete. Inspect provider access, model compatibility and pricing. '
                 'No automatic retry was made; uncertain calls may have incurred cost.')
    db.execute('UPDATE provider_verifications SET status=%s,error=%s,actual_cost=%s WHERE id=%s',
               (status, error, cost if known else None, vid))
    return db.one('SELECT * FROM provider_verifications WHERE id=%s', (vid,))


def list_state(project, user):
    guard(project, user)
    db.execute("UPDATE provider_verifications SET status='uncertain',error='Interrupted check; no automatic replay. Create a new explicit check if needed.' "
               "WHERE project_id=%s AND status='checking' AND created_at<now()-interval '2 minutes'", (project,))
    return {
        'server_key_available': bool(settings().openai_api_key), 'live_enabled': settings().live_enabled,
        'connections': db.all_rows(f'SELECT {CONNECTION_COLUMNS} FROM provider_connections WHERE project_id=%s AND user_id=%s ORDER BY created_at', (project, user)),
        'checks': db.all_rows('SELECT * FROM provider_verifications WHERE project_id=%s AND user_id=%s ORDER BY created_at DESC', (project, user)),
        'revisions': db.all_rows('SELECT * FROM harness_revisions WHERE project_id=%s AND user_id=%s ORDER BY created_at DESC', (project, user)),
    }


def save_revision(project, user, body):
    guard(project, user)
    request = body.model_dump(mode='json', exclude={'idempotency_key'})
    prior = db.one('SELECT * FROM harness_revisions WHERE project_id=%s AND user_id=%s AND idempotency_key=%s',
                   (project, user, body.idempotency_key))
    if prior:
        if prior['request'] != request:
            raise HTTPException(409, 'Revision key belongs to another request')
        return prior
    targets = {}
    for stage, vid in body.targets.model_dump().items():
        check = db.one("SELECT * FROM provider_verifications WHERE id=%s AND project_id=%s AND user_id=%s AND status='verified'", (vid, project, user))
        if not check or check['request']['fingerprints'] != fingerprints():
            raise HTTPException(409, 'Verify all research contracts with the current adapter and prompts first')
        conn = connection(project, check['connection_id'], user)
        targets[stage] = {k: check['request'][k] for k in ['model_id', 'input_usd_per_million', 'output_usd_per_million']}
        targets[stage].update(connection_id=str(conn['id']), connection_name=conn['name'], provider=conn['provider'], verification_id=str(vid))
    snapshot = {'targets': targets, 'limits': body.limits.model_dump(), 'fingerprints': fingerprints()}
    row = db.one('INSERT INTO harness_revisions(id,project_id,user_id,name,idempotency_key,request,snapshot) VALUES(%s,%s,%s,%s,%s,%s,%s) '
                 'ON CONFLICT(project_id,user_id,idempotency_key) DO NOTHING RETURNING *',
                 (db.uid(), project, user, body.name, body.idempotency_key, db.jsonb(request), db.jsonb(snapshot)))
    if row:
        return row
    return save_revision(project, user, body)


def run_snapshot(project, user, revision_id):
    guard(project, user)
    row = db.one('SELECT * FROM harness_revisions WHERE id=%s AND project_id=%s AND user_id=%s', (revision_id, project, user))
    if not row:
        raise HTTPException(404, 'Harness revision not found')
    snapshot = row['snapshot']
    if snapshot['fingerprints'] != fingerprints():
        raise HTTPException(409, 'Harness contracts changed; verify and save a new revision')
    for target in snapshot['targets'].values():
        connection(project, target['connection_id'], user)
    return {**snapshot, 'revision_id': str(row['id']), 'name': row['name']}
