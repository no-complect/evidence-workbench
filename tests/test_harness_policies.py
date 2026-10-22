from types import SimpleNamespace
import pytest
from workbench import credential_store, harness
from workbench.models import ModelVerification, ConnectionCreate


def test_credentials_encrypt_at_rest_and_key_permissions_fail_closed(tmp_path, monkeypatch):
    monkeypatch.setattr(credential_store, 'settings', lambda: SimpleNamespace(credential_store_path=tmp_path))
    secret = 'synthetic-provider-credential-only'
    encrypted = credential_store.encrypt(secret)
    assert secret not in encrypted and credential_store.decrypt(encrypted) == secret
    path = tmp_path / 'master.key'
    assert path.stat().st_mode & 0o777 == 0o600
    path.chmod(0o644)
    with pytest.raises(ValueError):
        credential_store.decrypt(encrypted)


def test_credential_source_and_probe_budget_are_explicit():
    for values in [{}, {'use_environment': True, 'api_key': 'synthetic-key-for-tests'}]:
        with pytest.raises(ValueError):
            ConnectionCreate(name='Test', **values)
    body = ModelVerification(model_id='fine-tuned:model-version', input_usd_per_million=1,
                             output_usd_per_million=3, idempotency_key='11111111-1111-4111-8111-111111111111')
    assert harness.check_cost(body) > 3 * 2200 * 3 / 1_000_000
    for value in [0, -1, float('inf'), float('nan')]:
        with pytest.raises(ValueError):
            ModelVerification(**{**body.model_dump(), 'input_usd_per_million': value})


def test_openai_adapter_uses_pinned_model_prices_and_fixed_endpoint(monkeypatch):
    from workbench.providers import OpenAIProvider
    from workbench.models import Plan, Task
    import langchain_openai
    observed = {}
    plan = Plan(tasks=[Task(id='test', topic='security', question='test question')], rationale='test')

    class Chat:
        def __init__(self, **kwargs):
            observed.update(kwargs)
        def with_structured_output(self, schema, **kwargs):
            observed['schema'] = schema
            assert kwargs == {'method': 'json_schema', 'strict': True, 'include_raw': True}
            return self
        def invoke(self, messages):
            return {'parsed': plan, 'raw': SimpleNamespace(usage_metadata={
                'input_tokens': 100, 'output_tokens': 50, 'total_tokens': 150})}
    monkeypatch.setattr(langchain_openai, 'ChatOpenAI', Chat)
    target = {'model_id': 'account-model', 'input_usd_per_million': 2, 'output_usd_per_million': 8}
    result, tokens, cost = OpenAIProvider(target, 'synthetic-test-credential').invoke(
        'plan', {'trusted_instructions': 'test', 'untrusted_sources': []}, Plan, timeout=8)
    assert result == plan and tokens == 150 and cost == pytest.approx(0.0006)
    assert observed['model'] == 'account-model' and observed['base_url'] == 'https://api.openai.com/v1'
    assert observed['max_retries'] == 0 and observed['max_tokens'] == 2200
