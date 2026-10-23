"""Safe environment target identities, independent of provider credentials."""

RESEARCH_ADAPTERS = {'openai': 'openai-json-schema-v1', 'anthropic': 'anthropic-json-schema-v1'}
JUDGE_ADAPTERS = {'openai': 'openai-structured-judge-v1', 'anthropic': 'anthropic-structured-judge-v1'}


def target_for(selection, settings):
    provider, model = ('anthropic', selection.removeprefix('anthropic:')) if selection.startswith('anthropic:') else ('openai', selection)
    if not model or len(selection) > 1024 or any(ord(char) < 32 or ord(char) == 127 for char in model):
        raise ValueError('Invalid model selection')
    priced = provider == 'openai' and model == settings.openai_model
    return {'provider': provider, 'credential_source': 'environment', 'model_id': model,
            'adapter': RESEARCH_ADAPTERS[provider],
            'input_usd_per_million': settings.model_input_usd_per_million if priced else None,
            'output_usd_per_million': settings.model_output_usd_per_million if priced else None}


def credential(target, settings):
    provider = target.get('provider', 'openai')
    if provider not in RESEARCH_ADAPTERS:
        raise ValueError('Unsupported saved model provider')
    key = getattr(settings, f'{provider}_api_key', '')
    if not key:
        raise ValueError('Server model credentials are unavailable')
    return key


def validate_adapter(target):
    provider = target.get('provider', 'openai')
    # Old OpenAI snapshots predate per-target adapters; preserve their recovery.
    expected = RESEARCH_ADAPTERS.get(provider)
    if not expected or target.get('adapter', expected if provider == 'openai' else None) != expected:
        raise ValueError('Pinned model adapter changed after submission')
