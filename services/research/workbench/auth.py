import hmac
import httpx
from fastapi import Header, HTTPException
from .config import settings, DEMO_USER
from . import db


def identity(authorization: str = Header(''), x_workbench_key: str = Header('')):
    s = settings()
    if not hmac.compare_digest(x_workbench_key, s.api_shared_secret):
        raise HTTPException(401, 'Backend authentication required')
    if s.auth_mode == 'demo' and s.app_env in {'local', 'test'}:
        return DEMO_USER
    if not authorization.startswith('Bearer '):
        raise HTTPException(401, 'Sign in to continue')
    try:
        response = httpx.get(s.supabase_url + '/auth/v1/user',
                             headers={
                                 'Authorization': authorization,
                                 'apikey': s.supabase_anon_key
                             },
                             timeout=10)
        if response.status_code != 200:
            raise HTTPException(401, 'Session expired or invalid')
        return response.json()['id']
    except httpx.HTTPError as exc:
        raise HTTPException(503, 'Authentication service unavailable') from exc


def authorize(project_id, user_id):
    if not db.one('SELECT 1 FROM project_memberships WHERE project_id=%s AND user_id=%s',
                  (project_id, user_id)):
        raise HTTPException(404, 'Project not found')
