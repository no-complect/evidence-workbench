"""Connection ownership, transaction isolation and per-request identity regressions."""

import httpx
import pytest
from fastapi import HTTPException
from starlette.requests import Request
from workbench import auth, db
from workbench.config import Settings


@pytest.mark.integration
def test_pool_reuses_connections_rolls_back_and_keeps_lock_sessions_separate(database):
    with db.pooled_connections() as pool:
        with db.connection() as conn:
            pid = conn.execute('SELECT pg_backend_pid()').fetchone()['pg_backend_pid']
            conn.execute('CREATE TEMP TABLE pool_rollback_probe(value int)')
        with pytest.raises(ValueError, match='rollback'):
            with db.connection() as conn:
                conn.execute('INSERT INTO pool_rollback_probe VALUES(1)')
                raise ValueError('rollback')
        with db.connection() as conn:
            assert (
                conn.execute('SELECT count(*) AS n FROM pool_rollback_probe').fetchone()['n'] == 0
            )
            assert conn.execute('SELECT pg_backend_pid()').fetchone()['pg_backend_pid'] == pid
            with db.dedicated_connection() as lock:
                assert lock.execute('SELECT pg_backend_pid()').fetchone()['pg_backend_pid'] != pid
        with db.pooled_connections() as nested:
            assert nested is pool
        assert not pool.closed
    assert pool.closed


def test_shared_auth_transport_verifies_each_token_without_retaining_user_headers(monkeypatch):
    profile = Settings(
        _env_file=None,
        auth_mode='supabase',
        supabase_url='https://synthetic.example',
        supabase_anon_key='synthetic-public',
    )
    monkeypatch.setattr(auth, 'settings', lambda: profile)
    observed = []

    def respond(request):
        token = request.headers['authorization']
        observed.append(token)
        if token == 'Bearer expired':
            return httpx.Response(401, json={})
        return httpx.Response(200, json={'id': token.removeprefix('Bearer ')})

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        request = Request({'type': 'http', 'state': {'auth_client': client}})
        assert auth.identity(request, 'Bearer first', profile.api_shared_secret) == 'first'
        assert auth.identity(request, 'Bearer second', profile.api_shared_secret) == 'second'
        with pytest.raises(HTTPException) as exc:
            auth.identity(request, 'Bearer expired', profile.api_shared_secret)
        assert exc.value.status_code == 401
        assert 'authorization' not in client.headers
        with pytest.raises(HTTPException):
            auth.identity(request, 'Bearer blocked', 'wrong-backend-key')
    assert observed == ['Bearer first', 'Bearer second', 'Bearer expired']
