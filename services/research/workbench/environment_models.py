"""Server-environment model discovery; credentials never leave the server."""
import re
import json
import hashlib
import httpx
from fastapi import HTTPException
from .auth import authorize
from .config import settings
from .provider_catalog import parse_catalog
from .harness import fingerprints

ENDPOINT = 'https://api.openai.com/v1/models'


def catalog(project, user):
    authorize(project, user)
    s = settings()
    result = {'configured': bool(s.openai_api_key), 'models': [], 'default_model': s.openai_model,
              'judge_pricing_configured': all(value is not None for value in
                  [s.model_input_usd_per_million, s.model_output_usd_per_million]),
              'live_enabled': s.live_enabled, 'pricing_configured': all(value is not None for value in
              [s.model_input_usd_per_million, s.model_output_usd_per_million, s.embedding_usd_per_million])}
    if not s.openai_api_key:
        return result
    try:
        with httpx.Client(timeout=15, follow_redirects=False, trust_env=False) as client:
            response = client.get(ENDPOINT, headers={'Authorization': 'Bearer ' + s.openai_api_key})
            response.raise_for_status()
            models, count = parse_catalog(response.json())
            request_id = response.headers.get('x-request-id', '')
    except Exception:
        raise HTTPException(502, 'Could not load models from OpenAI. Check the server OPENAI_API_KEY and connectivity.') from None
    return {**result, 'models': models, 'returned_count': count,
            'request_id': request_id if re.fullmatch(r'[A-Za-z0-9_-]{1,200}', request_id) else None}


def snapshot(project, user, model_id, limits, collection, configuration=None):
    s = settings()
    model_id = model_id or s.openai_model
    configuration = configuration.model_dump() if configuration else {}
    selected = {stage: configuration.get('stage_models', {}).get(stage) or model_id
                for stage in ['plan', 'assess', 'report']}
    available = catalog(project, user)['models']
    if any(model not in available for model in selected.values()):
        raise HTTPException(409, 'A selected model is not in the current server-key catalog. Refresh models and select again.')
    # Optional operator estimates apply only to the configured default model.
    # Never silently apply one model's prices to a different model.
    default = model_id == s.openai_model
    target = {'provider': 'openai', 'credential_source': 'environment', 'model_id': model_id,
              'input_usd_per_million': s.model_input_usd_per_million if default else None,
              'output_usd_per_million': s.model_output_usd_per_million if default else None}
    return {'name': 'Environment model', 'credential_source': 'environment',
            'targets': {stage: {**target, 'model_id': chosen,
                'input_usd_per_million': s.model_input_usd_per_million if chosen == s.openai_model else None,
                'output_usd_per_million': s.model_output_usd_per_million if chosen == s.openai_model else None}
                for stage, chosen in selected.items()},
            'configuration': configuration,
            'configuration_hash': hashlib.sha256(json.dumps(configuration, sort_keys=True).encode()).hexdigest(),
            'limits': limits.model_dump(), 'fingerprints': fingerprints(),
            'embedding_usd_per_million': s.embedding_usd_per_million,
            'embedding_config': collection['embedding_config'],
            'cost_estimates_available': all(model == s.openai_model for model in selected.values()) and all(value is not None for value in
                [s.model_input_usd_per_million, s.model_output_usd_per_million, s.embedding_usd_per_million])}
