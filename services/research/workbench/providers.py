import json
from .config import settings
from .models import Plan, Task, Assessment, Report, Claim, TOPICS


class DemoProvider:
    name = 'deterministic-fixture-v1'

    def invoke(self, stage, payload, schema, timeout=35):
        passages = payload['untrusted_sources']
        if stage == 'plan':
            q = payload['user_requirements'].lower()
            topics = TOPICS if 'three' in q or 'contradictory' in q else [
                'unknown'
            ] if 'million' in q else ['cost'] if 'cost' in q else ['security']
            result = Plan(
                tasks=[
                    Task(id=t,
                         topic=t,
                         question=f'Investigate {t} evidence and unresolved assumptions')
                    for t in topics
                ],
                rationale=
                'Fixture plan covering the selected seeded question. Review or edit before execution.'
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
            followups = [
                Task(id='retention-followup',
                     topic='retention',
                     question='retention stale contradiction current security requirements'),
                Task(id='unknown-followup',
                     topic='unknown',
                     question='unknown latency million users measured unresolved')
            ] if iteration == 1 else []
            result = Assessment(covered=covered,
                                gaps=gaps,
                                contradictions=contradictions,
                                followups=followups)
        else:
            claims = []
            for p in passages:
                body = p['passage']
                if body.startswith('#') or len(body) < 85 or 'SYNTHETIC PORTFOLIO FIXTURE' in body:
                    continue
                claims.append(
                    Claim(text=body, evidence_ids=[p['evidence_id']], support='direct_quote'))
            info = payload['durable_summary']
            result = Report(
                title='Enterprise AI assistant · evidence review',
                summary=
                'Scripted demo report: the following are exact excerpts from retrieved synthetic sources. Review the evidence and unresolved assumptions before making a decision.',
                claims=claims[:12],
                limitations=list(
                    dict.fromkeys(
                        info.get('gaps', []) + info.get('contradictions', []) + [
                            'All prices and architecture claims are synthetic. This demo measures integration behavior, not live model quality.',
                            'The reranker is disabled. No calibrated model confidence is provided.'
                        ])),
                recommendations=[
                    'Use the cited requirements as acceptance criteria. Validate workload, staffing assumptions, and retention exceptions before selecting a deployment.'
                ])
        return result, None, None


class OpenAIProvider:
    name = 'openai'

    def invoke(self, stage, payload, schema, timeout=35):
        from langchain_openai import ChatOpenAI
        s = settings()
        # Explicit capability contract: no temperature/reasoning params on unknown models.
        if s.openai_model not in {'gpt-4.1-mini', 'gpt-4.1', 'gpt-4.1-nano'}:
            raise ValueError(
                'Model capabilities not configured; supported path is GPT-4.1 family with JSON schema'
            )
        model = ChatOpenAI(model=s.openai_model,
                           api_key=s.openai_api_key,
                           max_tokens=2200,
                           timeout=timeout,
                           max_retries=0)
        output = model.with_structured_output(schema,
                                              method='json_schema',
                                              strict=True,
                                              include_raw=True).invoke([
                                                  ('system', payload['trusted_instructions']),
                                                  ('human',
                                                   json.dumps({
                                                       k: v
                                                       for k, v in payload.items()
                                                       if k != 'trusted_instructions'
                                                   }))
                                              ])
        if output.get('parsing_error') or output.get('parsed') is None:
            raise ValueError('Provider output failed schema validation')
        usage = output['raw'].usage_metadata
        if not usage:
            return output['parsed'], None, None
        cost = (usage['input_tokens'] * s.model_input_usd_per_million +
                usage['output_tokens'] * s.model_output_usd_per_million) / 1_000_000
        return output['parsed'], usage['total_tokens'], cost
