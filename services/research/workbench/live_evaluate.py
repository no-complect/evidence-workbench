"""Explicitly opt-in paid comparison and separate semantic judge. Never used in CI/demo."""
import argparse
import hashlib
import json
import time
from datetime import datetime, timezone
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal
from . import db
from .api import create_run
from .auth import authorize
from .config import settings, ROOT
from .context import estimate_tokens
from .evidence import for_run, verify
from .evaluate import fingerprint
from .models import RunCreate, Limits, Report


class SemanticJudgment(BaseModel):
    model_config = ConfigDict(extra='forbid')
    label: Literal['supported', 'contradicted', 'insufficient']
    reason: str = Field(max_length=600)


def evaluate(args):
    from langchain_openai import ChatOpenAI
    s = settings()
    if not args.allow_paid or not s.live_enabled or not s.openai_api_key:
        raise ValueError(
            'Paid evaluation requires --allow-paid, LIVE_ENABLED=true and server credentials')
    rates = (s.model_input_usd_per_million, s.model_output_usd_per_million,
             s.embedding_usd_per_million)
    if any(rate is None or rate < 0 for rate in rates):
        raise ValueError('Configure model input/output and embedding cost estimates')
    if s.openai_model not in {'gpt-4.1-mini', 'gpt-4.1', 'gpt-4.1-nano'}:
        raise ValueError('Unsupported model capability profile')
    authorize(args.project, args.user)
    if args.max_cost_usd <= 0 or args.max_cost_usd > 25:
        raise ValueError('Evaluation cost cap must be > 0 and <= 25 USD')
    # Each strategy receives the same fraction; judge calls share the final quarter.
    per_run = args.max_cost_usd / 4
    remaining_judge = per_run
    prompt = (ROOT / 'prompts/judge-v1.md').read_text()
    judge = ChatOpenAI(model=s.openai_model,
                       api_key=s.openai_api_key,
                       max_tokens=500,
                       timeout=30,
                       max_retries=0).with_structured_output(SemanticJudgment,
                                                             method='json_schema',
                                                             strict=True,
                                                             include_raw=True)
    rows = []
    snapshot = None
    for strategy in ['rag', 'workflow', 'agent']:
        body = RunCreate(collection_id=args.collection,
                         question=args.question,
                         mode='live',
                         strategy=strategy,
                         approve_plan=False,
                         web_enabled=False,
                         limits=Limits(estimated_cost_usd=per_run, wall_seconds=300),
                         idempotency_key=db.uid())
        started = time.monotonic()
        run = create_run(args.project, body, args.user)
        if snapshot is None:
            snapshot = run['corpus_versions']
        if run['corpus_versions'] != snapshot:
            db.execute('UPDATE research_runs SET cancel_requested=true WHERE id=%s', (run['id'], ))
            raise ValueError('Collection changed between strategies; comparison cancelled')
        while time.monotonic() - started < 360:
            run = db.scoped_run(run['id'], args.project)
            if run['status'] in {'completed', 'partial', 'failed', 'cancelled'}:
                break
            time.sleep(.3)
        else:
            db.execute('UPDATE research_runs SET cancel_requested=true WHERE id=%s', (run['id'], ))
            raise TimeoutError('Worker did not finish; cancellation requested')
        evidence = {str(e['id']): e for e in for_run(run)}
        judgments = []
        if run['report']:
            report = Report.model_validate(run['report'])
            verify(run, report)
            for claim in report.claims[:args.max_judged_claims]:
                content = json.dumps({
                    'claim':
                    claim.text,
                    'sources': [{
                        'id': str(eid),
                        'passage': evidence[str(eid)]['text'],
                        'metadata': evidence[str(eid)]['metadata']
                    } for eid in claim.evidence_ids]
                })
                token_bound = estimate_tokens(prompt + content) + 2000
                reserved = (token_bound * s.model_input_usd_per_million +
                            500 * s.model_output_usd_per_million) / 1_000_000
                if reserved > remaining_judge:
                    judgments.append({'status': 'ungraded', 'reason': 'Judge budget exhausted'})
                    break
                remaining_judge -= reserved
                try:
                    output = judge.invoke([('system', prompt), ('human', content)])
                except Exception:
                    # The charge may have occurred. Retain reservation and stop grading.
                    judgments.append({
                        'status': 'ungraded',
                        'reason': 'Judge call failed; cost reservation retained'
                    })
                    break
                if output.get('parsing_error') or output.get('parsed') is None:
                    judgments.append({
                        'status': 'ungraded',
                        'reason': 'Judge schema validation failed'
                    })
                    continue
                usage = output['raw'].usage_metadata
                actual_cost = None
                if usage:
                    actual_cost = (
                        usage['input_tokens'] * s.model_input_usd_per_million +
                        usage['output_tokens'] * s.model_output_usd_per_million) / 1_000_000
                    remaining_judge += reserved - actual_cost
                judgments.append({
                    'status':
                    'graded',
                    'claim_sha256':
                    hashlib.sha256(claim.text.encode()).hexdigest(),
                    'evidence_ids': [str(e) for e in claim.evidence_ids],
                    **output['parsed'].model_dump(), 'usage':
                    usage,
                    'estimated_cost_usd':
                    actual_cost if actual_cost is not None else reserved,
                    'cost_source':
                    'reported usage at configured rates' if usage else 'conservative reservation'
                })
        graded = [j for j in judgments if j['status'] == 'graded']
        rows.append({
            'strategy':
            strategy,
            'run_id':
            str(run['id']),
            'status':
            run['status'],
            'latency_seconds':
            time.monotonic() - started,
            'tokens':
            run['tokens_used'],
            'estimated_cost_usd':
            float(run['cost_used']),
            'semantic_support':
            sum(j['label'] == 'supported' for j in graded) / len(graded) if graded else None,
            'judgments':
            judgments
        })
    eid = db.uid()
    versions = {
        'mode': 'live',
        'model': s.openai_model,
        'judge_model': s.openai_model,
        'judge_prompt_sha256': hashlib.sha256(prompt.encode()).hexdigest(),
        'judge_limitations':
        'Model grading is not independent ground truth; same model family as writer, sample capped by claim and cost limits. No recall labels for this live collection.',
        'code_sha256': fingerprint(),
        'corpus_version_ids': snapshot,
        'context_policy': 'context-v1',
        'max_cost_usd': args.max_cost_usd,
        'judge_cost_charged_estimate': per_run - remaining_judge
    }
    out = ROOT / 'evals/results/live'
    out.mkdir(parents=True, exist_ok=True)
    path = out / f'{eid}.json'
    path.write_text(
        json.dumps(
            {
                'id': eid,
                'created_at': datetime.now(timezone.utc).isoformat(),
                'mode': 'live',
                'versions': versions,
                'raw': rows
            },
            indent=2,
            default=str) + '\n')
    print(f'Live comparison and judge grades saved to {path}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--allow-paid', action='store_true')
    parser.add_argument('--project', type=UUID, required=True)
    parser.add_argument('--collection', type=UUID, required=True)
    parser.add_argument('--user',
                        type=UUID,
                        required=True,
                        help='Authenticated project member UUID; privileged operator CLI')
    parser.add_argument('--question', required=True)
    parser.add_argument('--max-cost-usd', type=float, default=1.0)
    parser.add_argument('--max-judged-claims', type=int, choices=range(1, 21), default=5)
    evaluate(parser.parse_args())
