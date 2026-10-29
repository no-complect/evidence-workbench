"""Server-environment model discovery; credentials never leave the server."""

import hashlib
import json
import re

import httpx
from fastapi import HTTPException

from . import anthropic_catalog
from .auth import authorize
from .config import settings
from .harness import fingerprints
from .model_targets import target_for
from .provider_catalog import parse_catalog

ENDPOINT = 'https://api.openai.com/v1/models'


def catalog(project, user):
    authorize(project, user)
    s = settings()
    result = {
        'configured': bool(s.openai_api_key),
        'models': [],
        'default_model': s.openai_model,
        'judge_pricing_configured': all(
            value is not None
            for value in [s.model_input_usd_per_million, s.model_output_usd_per_million]
        ),
        'live_enabled': s.live_enabled,
        'pricing_configured': all(
            value is not None
            for value in [
                s.model_input_usd_per_million,
                s.model_output_usd_per_million,
                s.embedding_usd_per_million,
            ]
        ),
    }
    providers, models, count = [], [], 0
    if s.openai_api_key:
        try:
            with httpx.Client(timeout=15, follow_redirects=False, trust_env=False) as client:
                response = client.get(
                    ENDPOINT, headers={'Authorization': 'Bearer ' + s.openai_api_key}
                )
                response.raise_for_status()
                models, count = parse_catalog(response.json())
                if any(model.startswith('anthropic:') for model in models):
                    raise ValueError('Provider model ID conflicts with a reserved namespace')
                request_id = response.headers.get('x-request-id', '')
            providers.append({'provider': 'openai', 'count': len(models), 'error': None})
            result['request_id'] = (
                request_id if re.fullmatch(r'[A-Za-z0-9_-]{1,200}', request_id) else None
            )
        except Exception:
            providers.append(
                {
                    'provider': 'openai',
                    'count': 0,
                    'error': 'Could not load OpenAI models. Check the server key and connectivity.',
                }
            )
            models, count = [], 0
    if getattr(s, 'anthropic_api_key', ''):
        try:
            discovered, returned = anthropic_catalog.discover(s.anthropic_api_key)
            models += discovered
            count += returned
            providers.append({'provider': 'anthropic', 'count': len(discovered), 'error': None})
        except Exception:
            providers.append(
                {
                    'provider': 'anthropic',
                    'count': 0,
                    'error': 'Could not load Anthropic models. Check the server key and connectivity.',
                }
            )
    if providers and all(provider['error'] for provider in providers):
        raise HTTPException(
            502,
            'Could not load models from configured providers. Check server keys and connectivity.',
        )
    default = (
        s.openai_model
        if s.openai_api_key or not getattr(s, 'anthropic_api_key', '')
        else 'anthropic:' + s.anthropic_model
    )
    if getattr(s, 'anthropic_api_key', '') and not s.openai_api_key and default not in models:
        default = next(iter(models), '')
    return {
        **result,
        'configured': bool(providers),
        'models': models,
        'returned_count': count,
        'default_model': default,
        'providers': providers,
        'embeddings_configured': bool(s.openai_api_key),
        'pricing_configured': bool(s.openai_api_key) and result['pricing_configured'],
        'judge_pricing_configured': bool(s.openai_api_key) and result['judge_pricing_configured'],
    }


def environment_fingerprints():
    return {**fingerprints(), 'adapter': 'environment-research-json-schema-v1'}


def snapshot(project, user, model_id, limits, collection, configuration=None):
    s = settings()
    discovery = catalog(project, user)
    model_id = model_id or discovery.get('default_model', s.openai_model)
    configuration = configuration.model_dump() if configuration else {}
    selected = {
        stage: configuration.get('stage_models', {}).get(stage) or model_id
        for stage in ['plan', 'assess', 'report']
    }
    available = discovery['models']
    if any(model not in available for model in selected.values()):
        raise HTTPException(
            409,
            'A selected model is not in the current server-key catalog. Refresh models and select again.',
        )
    # Optional operator estimates apply only to the configured default model.
    # Never silently apply one model's prices to a different model.
    targets = {stage: target_for(chosen, s) for stage, chosen in selected.items()}
    return {
        'name': 'Environment model',
        'credential_source': 'environment',
        'targets': targets,
        'configuration': configuration,
        'configuration_hash': hashlib.sha256(
            json.dumps(configuration, sort_keys=True).encode()
        ).hexdigest(),
        'limits': limits.model_dump(),
        'fingerprints': environment_fingerprints(),
        'embedding_usd_per_million': s.embedding_usd_per_million,
        'embedding_config': collection['embedding_config'],
        'cost_estimates_available': all(model == s.openai_model for model in selected.values())
        and all(
            value is not None
            for value in [
                s.model_input_usd_per_million,
                s.model_output_usd_per_million,
                s.embedding_usd_per_million,
            ]
        ),
    }
