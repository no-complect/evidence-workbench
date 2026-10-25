"""Versioned claim grading boundary shared with the operator rubric/schema."""
import hashlib
import json
from .constants import ROOT
from .context import PROMPTS, estimate_tokens, redact
from .models import SemanticJudgment
from .model_targets import target_for, JUDGE_ADAPTERS
from .providers import structured_model

OUTPUT_TOKENS = 500
ADAPTER = 'openai-structured-judge-v1'


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def rubric():
    return (ROOT / 'prompts' / f'{PROMPTS["judge"]}.md').read_text()


def snapshot(configuration, available, settings):
    if configuration.model_id not in available:
        raise ValueError('The evaluation judge is not in the current model catalog')
    target = target_for(configuration.model_id, settings)
    rates = [target['input_usd_per_million'], target['output_usd_per_million']]
    return {'configuration': configuration.model_dump(), 'model_id': target['model_id'],
            'provider': target['provider'], 'credential_source': 'environment',
            'adapter': JUDGE_ADAPTERS[target['provider']],
            'prompt_sha256': hashlib.sha256(rubric().encode()).hexdigest(),
            'schema_sha256': digest(SemanticJudgment.model_json_schema()),
            'input_usd_per_million': rates[0], 'output_usd_per_million': rates[1],
            'cost_estimates_available': all(rate is not None for rate in rates),
            'output_tokens': OUTPUT_TOKENS, 'sampling': 'first N report claims per run; no unsampled claim is counted as graded'}


def validate_snapshot(pinned):
    expected = JUDGE_ADAPTERS.get(pinned.get('provider', 'openai'))
    if (not expected or pinned['adapter'] != expected or pinned['output_tokens'] != OUTPUT_TOKENS
            or pinned['prompt_sha256'] != hashlib.sha256(rubric().encode()).hexdigest()
            or pinned['schema_sha256'] != digest(SemanticJudgment.model_json_schema())):
        raise ValueError('Judge contract changed after evaluation submission')


def prepare_claim(claim, evidence):
    ids = [str(eid) for eid in claim.evidence_ids]
    if any(eid not in evidence for eid in ids):
        raise ValueError('Claim references evidence outside this run')
    payload = redact({'claim': claim.text, 'sources': [
        {'id': eid, 'passage': evidence[eid]['text'], 'metadata': evidence[eid]['metadata']}
        for eid in ids]})
    if 'claim' not in payload or 'sources' not in payload:
        raise ValueError('Claim context could not be safely prepared')
    content = json.dumps(payload)
    bound = estimate_tokens(rubric() + content + json.dumps(SemanticJudgment.model_json_schema())) + 256 + OUTPUT_TOKENS
    return content, bound, {'claim_sha256': digest(claim.model_dump(mode='json')),
        'claim_preview': payload['claim'], 'evidence_ids': ids,
        'source_version_ids': sorted({str(evidence[eid]['version_id']) for eid in ids}),
        'input_sha256': digest(payload), 'context_policy': 'cited-passages-only/redacted-v1'}


def usage_counts(raw):
    usage = getattr(raw, 'usage_metadata', None)
    if not isinstance(usage, dict):
        return None
    values = [usage.get('input_tokens'), usage.get('output_tokens')]
    if any(type(value) is not int or value < 0 for value in values):
        return None
    return {'input_tokens': values[0], 'output_tokens': values[1], 'total_tokens': sum(values)}


class SemanticJudge:
    def __init__(self, pinned, key):
        self.pinned, self.key = pinned, key

    def invoke(self, content, timeout):
        return structured_model(self.pinned, self.key, SemanticJudgment, OUTPUT_TOKENS,
            timeout).invoke([('system', rubric()), ('human', content)])
