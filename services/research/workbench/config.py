from pathlib import Path
from functools import lru_cache
from pydantic import model_validator, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from .constants import ROOT, DEMO_USER, DEMO_PROJECT, DEMO_COLLECTION  # re-export


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore', env_ignore_empty=True)
    app_env: str = 'local'
    auth_mode: str = 'demo'
    database_url: str = 'postgresql://workbench:workbench@localhost:55432/workbench'
    api_shared_secret: str = 'local-demo-only-not-for-production'
    storage_path: Path = Path('.runtime/objects')
    storage_backend: str = 'local'
    live_enabled: bool = False
    openai_api_key: str = ''
    openai_model: str = 'gpt-4.1-mini'
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
    lease_seconds: int = 30
    poll_seconds: float = 0.5

    @model_validator(mode='after')
    def secure_configuration(self):
        if self.app_env not in {'local', 'test', 'production'}:
            raise ValueError('APP_ENV must be local, test, or production')
        if self.auth_mode not in {'demo', 'supabase'}:
            raise ValueError('Unsupported AUTH_MODE')
        if self.app_env == 'production':
            if self.auth_mode != 'supabase':
                raise ValueError('Production rejects demo authentication')
            if len(self.api_shared_secret) < 32 or self.api_shared_secret.startswith('local-'):
                raise ValueError('Production requires a random API_SHARED_SECRET (32+ characters)')
            if not self.supabase_url.startswith('https://') or not self.supabase_anon_key:
                raise ValueError('Production requires Supabase Auth')
            if self.storage_backend != 'supabase':
                raise ValueError('Production requires Supabase Storage')
        if self.storage_backend not in {'local', 'supabase'}:
            raise ValueError('Unsupported storage adapter')
        return self


@lru_cache
def settings():
    return Settings()


__all__ = ['Settings', 'settings', 'ROOT', 'DEMO_USER', 'DEMO_PROJECT', 'DEMO_COLLECTION']
