from functools import lru_cache
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from pydantic import Field, ValidationError, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from .constants import DEMO_COLLECTION, DEMO_PROJECT, DEMO_USER, ROOT  # re-export


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file='.env', extra='ignore', env_ignore_empty=True, hide_input_in_errors=True
    )
    app_env: str = 'local'
    auth_mode: str = 'demo'
    database_url: str = 'postgresql://workbench:workbench@localhost:55432/workbench'
    api_shared_secret: str = 'local-demo-only-not-for-production'
    storage_path: Path = Path('.runtime/objects')
    storage_backend: str = 'local'
    credential_store_path: Path = Path('.runtime/credentials')
    live_enabled: bool = False
    openai_api_key: str = ''
    openai_model: str = 'gpt-4.1-mini'
    anthropic_api_key: str = ''
    anthropic_model: str = ''
    openai_embedding_model: str = 'text-embedding-3-small'
    model_input_usd_per_million: float | None = Field(None, ge=0, allow_inf_nan=False)
    model_output_usd_per_million: float | None = Field(None, ge=0, allow_inf_nan=False)
    embedding_usd_per_million: float | None = Field(None, ge=0, allow_inf_nan=False)
    tavily_api_key: str = ''
    web_search_usd_per_call: float | None = Field(None, ge=0, allow_inf_nan=False)
    supabase_url: str = ''
    supabase_anon_key: str = ''
    supabase_service_role_key: str = ''
    supabase_storage_bucket: str = 'research-sources'
    lease_seconds: int = Field(30, ge=1, le=3600)
    poll_seconds: float = Field(0.5, gt=0, le=60, allow_inf_nan=False)
    db_pool_max_size: int = Field(10, ge=2, le=100)

    @model_validator(mode='after')
    def secure_configuration(self):
        issues = []
        if self.app_env not in {'local', 'test', 'production'}:
            issues.append('APP_ENV must be local, test, or production')
        if self.auth_mode not in {'demo', 'supabase'}:
            issues.append('AUTH_MODE must be demo or supabase')
        if self.storage_backend not in {'local', 'supabase'}:
            issues.append('STORAGE_BACKEND must be local or supabase')
        if not self.api_shared_secret.strip():
            issues.append('API_SHARED_SECRET is required')
        if self.auth_mode == 'supabase' or self.storage_backend == 'supabase':
            if not valid_service_origin(self.supabase_url, production=self.app_env == 'production'):
                issues.append(
                    'SUPABASE_URL must be an HTTPS origin (loopback HTTP is allowed locally)'
                )
        if self.auth_mode == 'supabase' and not self.supabase_anon_key.strip():
            issues.append('SUPABASE_ANON_KEY is required for Supabase authentication')
        if self.storage_backend == 'supabase':
            if not self.supabase_service_role_key.strip():
                issues.append('SUPABASE_SERVICE_ROLE_KEY is required for Supabase Storage')
            if not self.supabase_storage_bucket.strip():
                issues.append('SUPABASE_STORAGE_BUCKET must name a private bucket')
        if self.app_env == 'production':
            if self.auth_mode != 'supabase':
                issues.append('Production rejects demo authentication; set AUTH_MODE=supabase')
            if len(self.api_shared_secret.strip()) < 32 or self.api_shared_secret.startswith(
                'local-'
            ):
                issues.append('Production requires a random API_SHARED_SECRET (32+ characters)')
            if self.storage_backend != 'supabase':
                issues.append('Production requires STORAGE_BACKEND=supabase')
            if 'database_url' not in self.model_fields_set or not valid_database(self.database_url):
                issues.append(
                    'DATABASE_URL must explicitly use a PostgreSQL direct/session TLS connection '
                    '(sslmode=require, verify-ca or verify-full); no local default'
                )
        if issues:
            raise ValueError('; '.join(issues))
        self.supabase_url = self.supabase_url.rstrip('/')
        return self


def valid_service_origin(value, *, production):
    try:
        url = urlsplit(value)
        return bool(
            url.hostname
            and url.port != 0
            and not url.username
            and not url.password
            and not url.query
            and not url.fragment
            and url.path in {'', '/'}
            and not any(char.isspace() or char == '\\' for char in value)
            and (
                url.scheme == 'https'
                or not production
                and url.scheme == 'http'
                and url.hostname in {'localhost', '127.0.0.1', '::1'}
            )
        )
    except ValueError:
        return False


def valid_database(value):
    try:
        url = urlsplit(value)
        return bool(
            url.scheme in {'postgres', 'postgresql'}
            and url.hostname
            and url.port != 0
            and url.hostname not in {'localhost', '127.0.0.1', '::1', 'db'}
            and url.path.strip('/')
            and not url.fragment
            and parse_qs(url.query).get('sslmode') in [['require'], ['verify-ca'], ['verify-full']]
        )
    except ValueError:
        return False


def configuration_status(s):
    """Authorized bootstrap metadata: static capability decisions, never secret values/probes."""
    notices = []
    if s.live_enabled and not s.openai_api_key:
        notices.append(
            'Live research is unavailable. Set OPENAI_API_KEY in the server environment '
            'for RAG embeddings, then restart the API and both workers. Demo remains available.'
        )
    return {
        'web_search_enabled': bool(
            s.live_enabled
            and s.openai_api_key
            and s.tavily_api_key
            and s.web_search_usd_per_call is not None
        ),
        'notices': notices,
    }


class ConfigurationError(RuntimeError):
    pass


@lru_cache
def settings():
    try:
        return Settings()
    except ValidationError as exc:
        # Field parsing errors can contain secret-bearing input. Only names and
        # our fixed model-validator messages cross startup/log boundaries.
        issues = []
        for error in exc.errors(include_input=False):
            field = error['loc'][0] if error['loc'] else None
            issues.append(
                f'{str(field).upper()} has an invalid value'
                if field
                else str(error.get('ctx', {}).get('error', 'Invalid configuration'))
            )
        raise ConfigurationError('Configuration needs attention: ' + '; '.join(issues)) from None


__all__ = ['Settings', 'settings', 'ROOT', 'DEMO_USER', 'DEMO_PROJECT', 'DEMO_COLLECTION']
