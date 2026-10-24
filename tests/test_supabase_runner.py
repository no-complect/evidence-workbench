"""Keep the identity verification runner away from configured hosted resources."""
import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('supabase_verification', ROOT / 'scripts/verify-supabase.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def test_local_environment_removes_hosted_and_paid_credentials():
    names = ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
             'NEXT_PUBLIC_SUPABASE_URL', 'API_SHARED_SECRET', 'DATABASE_URL',
             'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'TAVILY_API_KEY',
             'CREDENTIAL_STORE_PATH', 'STORAGE_PATH']
    env = runner.local_environment({**dict.fromkeys(names, 'synthetic-private'), 'LIVE_ENABLED': 'true'})
    assert not any(value == 'synthetic-private' for value in env.values())
    assert env['LIVE_ENABLED'] == 'false' and env['AUTH_MODE'] == 'supabase'
    assert env['APP_ENV'] == 'test' and env['STORAGE_BACKEND'] == 'supabase'


@pytest.mark.parametrize('field,value', [
    ('API_URL', 'https://hosted.example'), ('API_URL', 'http://127.0.0.1:54321'),
    ('DB_URL', 'postgresql://postgres:local@hosted.example:54322/postgres'),
    ('SERVICE_ROLE_KEY', ''),
])
def test_status_rejects_any_non_owned_service(field, value):
    status = {'API_URL': 'http://127.0.0.1:43123',
              'DB_URL': 'postgresql://postgres:local@127.0.0.1:43124/postgres',
              'ANON_KEY': 'synthetic-anon', 'SERVICE_ROLE_KEY': 'synthetic-service'}
    assert runner.local_status(status, 43123, 43124) is status
    with pytest.raises(RuntimeError):
        runner.local_status({**status, field: value}, 43123, 43124)
