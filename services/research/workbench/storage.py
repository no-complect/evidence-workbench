from typing import Protocol
import tempfile
from pathlib import Path
import httpx
from .config import settings


class ObjectStorage(Protocol):

    def put(self, key: str, data: bytes, content_type: str) -> None:
        ...

    def get(self, key: str) -> bytes:
        ...


class LocalStorage:

    def path(self, key):
        base = settings().storage_path.resolve()
        path = (base / key).resolve()
        if not path.is_relative_to(base) or path == base:
            raise ValueError('Invalid object key')
        return path

    def put(self, key, data, content_type):
        path = self.path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.upload-',
                                             delete=False) as file:
                file.write(data)
                temporary = Path(file.name)
            try:
                temporary.replace(path)
            finally:
                temporary.unlink(missing_ok=True)

    def get(self, key):
        return self.path(key).read_bytes()


class SupabaseStorage:

    def url(self, key):
        if '..' in key or not all(c.isalnum() or c in '/-.' for c in key):
            raise ValueError('Invalid object key')
        s = settings()
        return f'{s.supabase_url}/storage/v1/object/{s.supabase_storage_bucket}/{key}'

    def headers(self):
        key = settings().supabase_service_role_key
        if not key:
            raise ValueError('Supabase Storage credentials missing')
        return {'Authorization': f'Bearer {key}', 'apikey': key}

    def put(self, key, data, content_type):
        response = httpx.post(self.url(key),
                              headers={
                                  **self.headers(), 'Content-Type': content_type,
                                  'x-upsert': 'false'
                              },
                              content=data,
                              timeout=30)
        if response.status_code not in (200, 201, 400, 409):
            response.raise_for_status()
        if response.status_code == 400 and 'Duplicate' not in response.text:
            raise ValueError('Storage upload rejected')

    def get(self, key):
        response = httpx.get(self.url(key), headers=self.headers(), timeout=30)
        response.raise_for_status()
        return response.content


def storage() -> ObjectStorage:
    return SupabaseStorage() if settings().storage_backend == 'supabase' else LocalStorage()
