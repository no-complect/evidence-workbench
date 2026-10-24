"""Required configuration fails early; optional integrations preserve the demo."""
import importlib.util
import json
from pathlib import Path

import pytest
from pydantic import ValidationError
from workbench.config import Settings, ConfigurationError, configuration_status, settings


PRODUCTION = dict(app_env='production', auth_mode='supabase', storage_backend='supabase',
                  database_url='postgresql://owner:synthetic-db-private@db.example/research?sslmode=require',
                  api_shared_secret='synthetic-random-server-private-at-least-32-characters',
                  supabase_url='https://synthetic.example', supabase_anon_key='synthetic-public',
                  supabase_service_role_key='synthetic-storage-private')


def test_production_validates_without_contacting_services():
    s = Settings(_env_file=None, **PRODUCTION)
    assert not s.live_enabled and not s.openai_api_key
    assert configuration_status(s) == {'web_search_enabled': False, 'notices': []}


@pytest.mark.parametrize('name,value,expected', [
    ('database_url', '', 'DATABASE_URL'),
    ('database_url', 'postgresql://owner:synthetic-db-private@localhost/research?sslmode=require', 'DATABASE_URL'),
    ('database_url', 'postgresql://owner:synthetic-db-private@db.example/research', 'DATABASE_URL'),
    ('database_url', 'postgresql://owner:synthetic-db-private@db.example/research?sslmode=disable', 'DATABASE_URL'),
    ('supabase_service_role_key', '', 'SUPABASE_SERVICE_ROLE_KEY'),
    ('supabase_anon_key', '', 'SUPABASE_ANON_KEY'),
    ('supabase_url', 'https://user:synthetic-private@db.example', 'SUPABASE_URL'),
    ('supabase_url', 'http://db.example', 'SUPABASE_URL'),
    ('api_shared_secret', 'synthetic-private-short', 'API_SHARED_SECRET'),
    ('storage_backend', 'local', 'STORAGE_BACKEND'),
])
def test_production_required_settings_fail_without_echoing_secrets(name, value, expected):
    with pytest.raises(ValidationError) as exc:
        Settings(_env_file=None, **{**PRODUCTION, name: value})
    assert expected in str(exc.value) and 'synthetic-' not in str(exc.value)


def test_missing_production_database_never_uses_local_default(monkeypatch):
    monkeypatch.delenv('DATABASE_URL', raising=False)
    values = {k: v for k, v in PRODUCTION.items() if k != 'database_url'}
    with pytest.raises(ValidationError, match='DATABASE_URL'):
        Settings(_env_file=None, **values)


def test_supabase_local_auth_and_storage_validate_separately():
    with pytest.raises(ValidationError, match='SUPABASE_ANON_KEY'):
        Settings(_env_file=None, auth_mode='supabase')
    with pytest.raises(ValidationError, match='SUPABASE_SERVICE_ROLE_KEY'):
        Settings(_env_file=None, storage_backend='supabase')
    s = Settings(_env_file=None, auth_mode='supabase', supabase_url='http://127.0.0.1:54321',
                 supabase_anon_key='synthetic-public')
    assert s.storage_backend == 'local'


def test_optional_provider_configuration_does_not_stop_demo_or_claim_access():
    s = Settings(_env_file=None)
    assert s.auth_mode == 'demo' and configuration_status(s)['notices'] == []
    s = Settings(_env_file=None, live_enabled=True)
    status = configuration_status(s)
    assert not status['web_search_enabled'] and 'OPENAI_API_KEY' in status['notices'][0]
    s = Settings(_env_file=None, live_enabled=True, openai_api_key='synthetic-model-private',
                 tavily_api_key='synthetic-web-private', web_search_usd_per_call=0)
    assert configuration_status(s)['web_search_enabled']
    assert 'synthetic-' not in json.dumps(configuration_status(s))


def test_startup_field_parse_errors_only_name_variables(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('MODEL_INPUT_USD_PER_MILLION', 'synthetic-private-invalid-number')
    settings.cache_clear()
    try:
        with pytest.raises(ConfigurationError) as exc:
            settings()
        assert 'MODEL_INPUT_USD_PER_MILLION' in str(exc.value)
        assert 'synthetic-private' not in str(exc.value)
    finally:
        settings.cache_clear()


def test_environment_check_reports_failure_without_raw_settings(monkeypatch, capsys):
    path = Path(__file__).resolve().parents[1] / 'scripts/check-environment.py'
    spec = importlib.util.spec_from_file_location('check_environment', path)
    check = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(check)
    monkeypatch.setattr(check, 'settings', lambda: Settings(_env_file=None))
    assert check.main() == 0
    assert 'PASS:' in capsys.readouterr().out

    def invalid():
        raise ConfigurationError('Configuration needs attention: SUPABASE_SERVICE_ROLE_KEY is required')

    monkeypatch.setattr(check, 'settings', invalid)
    assert check.main() == 1
    assert 'SUPABASE_SERVICE_ROLE_KEY' in capsys.readouterr().out


def test_invalid_required_settings_stop_api_before_database_or_traffic(monkeypatch):
    from fastapi.testclient import TestClient
    from workbench import api

    def invalid():
        raise ConfigurationError('Configuration needs attention: DATABASE_URL is required')

    def unexpected_database(*args, **kwargs):
        raise AssertionError('Startup must validate before database readiness')

    monkeypatch.setattr(api, 'settings', invalid)
    monkeypatch.setattr(api.db, 'one', unexpected_database)
    with pytest.raises(ConfigurationError, match='DATABASE_URL'):
        with TestClient(api.app):
            pytest.fail('Invalid configuration must not accept traffic')
