import hashlib
import json
import re
from .constants import ROOT

POLICY = 'context-v1'
CAPS = {'plan': 1800, 'assess': 5000, 'report': 6500}


class ContextOverflow(ValueError):
    pass


def estimate_tokens(text):
    # UTF-8 byte count is a deliberately conservative upper bound (one byte/token).
    # No tokenizer dependency or false precision; output reservation is separate.
    return len(text.encode('utf-8'))


def redact(value):
    text = json.dumps(value, ensure_ascii=False, default=str)
    text = re.sub(r'(sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_.-]{20,})', '[REDACTED CREDENTIAL]', text)
    text = re.sub(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', '[REDACTED EMAIL]', text)
    text = re.sub(
        r'(?i)(api[_ -]?key|password|secret|authorization)([\\"\s:=]+)[A-Za-z0-9_./+-]{6,}',
        r'\1\2[REDACTED]', text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {'redacted': 'Context removed because safe redaction could not preserve the schema'}


def assemble(stage, question, evidence, summary=None):
    prompt = (ROOT / 'prompts' / f'{stage}-v1.md').read_text()
    payload = {
        'trusted_instructions': prompt,
        'user_requirements': question,
        'durable_summary': summary or {},
        'untrusted_sources': []
    }
    if estimate_tokens(json.dumps(payload)) > CAPS[stage]:
        raise ContextOverflow(f'{stage.title()} input exceeds its context budget')
    selected = []
    excluded = []
    seen = set()
    sources = {}
    # Diversity and freshness precede relevance tie-breaks; IDs make selection deterministic.
    ranked = sorted(
        evidence,
        key=lambda e:
        (bool(e['metadata'].get('untrusted_instructions')), bool(e['metadata'].get('stale')),
         -float(e['scores'].get('rrf', 0)), str(e['id'])))
    for e in ranked:
        digest = hashlib.sha256(e['text'].encode()).hexdigest()
        reason = None
        if e['text'].startswith('#') or len(
                e['text']) < 70 or 'SYNTHETIC PORTFOLIO FIXTURE' in e['text']:
            reason = 'Heading or repeated corpus disclaimer'
        elif e['metadata'].get('untrusted_instructions'):
            reason = 'Flagged adversarial fixture; excluded from model context'
        elif digest in seen:
            reason = 'Duplicate passage'
        elif sources.get(e['source_name'], 0) >= 3:
            reason = 'Source diversity cap'
        candidate = {
            'evidence_id': str(e['id']),
            'passage': e['text'],
            'source': e['source_name'],
            'page': e['page'],
            'section': e['section'],
            'offsets': [e['start_offset'], e['end_offset']],
            'metadata': e['metadata']
        }
        if not reason and estimate_tokens(
                json.dumps({
                    **payload, 'untrusted_sources':
                    payload['untrusted_sources'] + [candidate]
                })) > CAPS[stage]:
            reason = 'Stage token budget'
        if reason:
            excluded.append({'evidence_id': str(e['id']), 'reason': reason})
        else:
            payload['untrusted_sources'].append(candidate)
            selected.append({
                'evidence_id': str(e['id']),
                'reason': 'Relevant evidence; freshness and source diversity policy'
            })
            seen.add(digest)
            sources[e['source_name']] = sources.get(e['source_name'], 0) + 1
    return payload, {
        'policy_version': POLICY,
        'prompt_id': f'{stage}-v1',
        'prompt_hash': hashlib.sha256(prompt.encode()).hexdigest(),
        'input_tokens_estimate': estimate_tokens(json.dumps(payload)),
        'token_estimator': 'utf8-bytes-upper-bound-v1',
        'selected': selected,
        'excluded': excluded,
        'assembled_input': redact(payload),
        'output_token_reservation': 2200
    }
