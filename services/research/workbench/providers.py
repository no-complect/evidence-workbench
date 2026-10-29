import json

from pydantic import ValidationError

from .config import settings
from .models import TOPICS, Assessment, Claim, Plan, Report, Task


class ModelCompatibilityError(ValueError):
    """Safe public error for a model that cannot serve this research contract."""


def structured_model(target, key, schema, output_tokens, timeout):
    """Fixed provider endpoints, bounded calls and no SDK retries or tool execution."""
    kwargs = {
        'model': target['model_id'],
        'api_key': key,
        'max_tokens': output_tokens,
        'timeout': timeout,
        'max_retries': 0,
    }
    provider = target.get('provider', 'openai')
    if provider == 'anthropic':
        from langchain_anthropic import ChatAnthropic

        model = ChatAnthropic(**kwargs, base_url='https://api.anthropic.com')
        return model.with_structured_output(schema, method='json_schema', include_raw=True)
    if provider == 'openai':
        from langchain_openai import ChatOpenAI

        model = ChatOpenAI(**kwargs, base_url='https://api.openai.com/v1', stream_usage=False)
        return model.with_structured_output(
            schema, method='json_schema', strict=True, include_raw=True
        )
    raise ModelCompatibilityError('Unsupported model provider')


class DemoProvider:
    name = 'deterministic-fixture-v1'

    def invoke(self, stage, payload, schema, timeout=35):
        passages = payload['untrusted_sources']
        if stage == 'plan':
            q = payload['user_requirements'].lower()
            topics = (
                TOPICS
                if 'three' in q or 'contradictory' in q
                else ['unknown']
                if 'million' in q
                else ['cost']
                if 'cost' in q
                else ['security']
            )
            result = Plan(
                tasks=[
                    Task(
                        id=t,
                        topic=t,
                        question=f'Investigate {t} evidence and unresolved assumptions',
                    )
                    for t in topics
                ],
                rationale='Fixture plan covering the selected seeded question. Review or edit before execution.',
            )
        elif stage == 'assess':
            texts = ' '.join(p['passage'] for p in passages).lower()
            requested = payload['durable_summary'].get('topics', TOPICS)
            covered = [
                t for t in requested if any(t in p['metadata'].get('topics', []) for p in passages)
            ]
            gaps = [f'Insufficient evidence for {t}' for t in requested if t not in covered]
            contradictions = []
            if '30-day' in texts or '30 days' in texts:
                contradictions.append(
                    'The archived 30-day retention assumption conflicts with the seven-day current requirement; use revision 3.'
                )
            if '$1,900' in texts:
                contradictions.append(
                    'Archived and current cost estimates use different traffic baselines and must not be compared directly.'
                )
            gaps.append(
                'No measured latency at one million users or validated total staffing cost is available in the synthetic corpus.'
            )
            iteration = payload['durable_summary'].get('iteration', 1)
            followups = (
                [
                    Task(
                        id='retention-followup',
                        topic='retention',
                        question='retention stale contradiction current security requirements',
                    ),
                    Task(
                        id='unknown-followup',
                        topic='unknown',
                        question='unknown latency million users measured unresolved',
                    ),
                ]
                if iteration == 1
                else []
            )
            result = Assessment(
                covered=covered, gaps=gaps, contradictions=contradictions, followups=followups
            )
        else:
            claims = []
            for p in passages:
                body = p['passage']
                if body.startswith('#') or len(body) < 85 or 'SYNTHETIC PORTFOLIO FIXTURE' in body:
                    continue
                claims.append(
                    Claim(text=body, evidence_ids=[p['evidence_id']], support='direct_quote')
                )
            info = payload['durable_summary']
            result = Report(
                title='Enterprise AI assistant · evidence review',
                summary='Scripted demo report: the following are exact excerpts from retrieved synthetic sources. Review the evidence and unresolved assumptions before making a decision.',
                claims=claims[:12],
                limitations=list(
                    dict.fromkeys(
                        info.get('gaps', [])
                        + info.get('contradictions', [])
                        + [
                            'All prices and architecture claims are synthetic. This demo measures integration behavior, not live model quality.',
                            'The reranker is disabled. No calibrated model confidence is provided.',
                        ]
                    )
                ),
                recommendations=[
                    'Use the cited requirements as acceptance criteria. Validate workload, staffing assumptions, and retention exceptions before selecting a deployment.'
                ],
            )
        return result, None, None


def invoke_research(target, key, payload, schema, timeout):
    try:
        output = structured_model(target, key, schema, 2200, timeout).invoke(
            [
                ('system', payload['trusted_instructions']),
                (
                    'human',
                    json.dumps({k: v for k, v in payload.items() if k != 'trusted_instructions'}),
                ),
            ]
        )
    except ValidationError:
        # OpenAI's SDK can reject native structured output before include_raw parses it.
        raise ModelCompatibilityError('Provider output failed schema validation') from None
    except Exception as exc:
        if getattr(exc, 'status_code', None) in {400, 403, 404, 422}:
            raise ModelCompatibilityError(
                'Selected model could not serve the research contract'
            ) from None
        raise
    if output.get('parsing_error') or output.get('parsed') is None:
        raise ModelCompatibilityError('Provider output failed schema validation')
    usage = output['raw'].usage_metadata
    if not usage:
        return output['parsed'], None, None
    prices = [target['input_usd_per_million'], target['output_usd_per_million']]
    cost = (
        None
        if any(price is None for price in prices)
        else (usage['input_tokens'] * prices[0] + usage['output_tokens'] * prices[1]) / 1_000_000
    )
    return output['parsed'], usage['total_tokens'], cost


class OpenAIProvider:
    name = 'openai'

    def __init__(self, target=None, api_key=None):
        self.target, self.api_key = target, api_key

    def invoke(self, stage, payload, schema, timeout=35):
        s = settings()
        target = self.target or {
            'model_id': s.openai_model,
            'input_usd_per_million': s.model_input_usd_per_million,
            'output_usd_per_million': s.model_output_usd_per_million,
        }
        return invoke_research(target, self.api_key or s.openai_api_key, payload, schema, timeout)


class AnthropicProvider:
    name = 'anthropic'

    def __init__(self, target, api_key):
        self.target, self.api_key = target, api_key

    def invoke(self, stage, payload, schema, timeout=35):
        if self.target.get('provider') != 'anthropic' or not self.api_key:
            raise ModelCompatibilityError('Anthropic target or credentials unavailable')
        return invoke_research(self.target, self.api_key, payload, schema, timeout)
