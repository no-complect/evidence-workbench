"""Bounded complete discovery at a fixed endpoint. No inference or credentials stored."""

import time

import httpx

from .provider_catalog import parse_catalog

ENDPOINT = 'https://api.anthropic.com/v1/models'
API_VERSION = '2023-06-01'


def discover(key):
    ids, seen, count, cursor = set(), set(), 0, None
    deadline = time.monotonic() + 15
    with httpx.Client(follow_redirects=False, trust_env=False) as client:
        for _ in range(100):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ValueError('Model discovery deadline exceeded')
            params = {'limit': 1000}
            if cursor:
                params['after_id'] = cursor
            response = client.get(
                ENDPOINT,
                headers={'x-api-key': key, 'anthropic-version': API_VERSION},
                params=params,
                timeout=remaining,
            )
            response.raise_for_status()
            payload = response.json()
            models, returned = parse_catalog(payload)
            count += returned
            ids.update(models)
            if count > 10000 or any(len('anthropic:' + model) > 1024 for model in ids):
                raise ValueError('Model catalog exceeds the local safety limit')
            if type(payload.get('has_more')) is not bool:
                raise ValueError('Invalid model pagination')
            if not payload['has_more']:
                return ['anthropic:' + model for model in sorted(ids)], count
            cursor = payload.get('last_id')
            if not returned or cursor not in models or cursor in seen:
                raise ValueError('Model pagination did not advance')
            seen.add(cursor)
    raise ValueError('Model pagination exceeds the local safety limit')
