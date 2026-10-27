"""Validate/score challenges offline, or explicitly opt in to bounded judge-only calls."""
import argparse
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from pydantic import ValidationError
from . import judge_policy
from .config import settings
from .constants import RESULTS
from .context import PROMPTS, redact
from .evaluate import fingerprint
from .judge_calibration import CASES, load_cases, prepare, score
from .model_targets import credential
from .models import JudgeConfiguration, SemanticJudgment


def persist(path, report, *, initial=False):
    """Save a reservation before transmission; a killed command never auto-resumes it."""
    encoded = json.dumps(report, indent=2, allow_nan=False) + '\n'
    if initial:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('x') as handle:
            handle.write(encoded)
    else:
        temporary = path.with_suffix('.pending')
        with temporary.open('x') as handle:
            handle.write(encoded)
        os.replace(temporary, path)


def priced_tokens(tokens, pinned):
    rates = [pinned['input_usd_per_million'], pinned['output_usd_per_million']]
    if any(rate is None for rate in rates):
        return None
    return (tokens['input_tokens'] * rates[0] + tokens['output_tokens'] * rates[1]) / 1_000_000


def run(dataset, configuration, server, *, allow_paid, max_calls, case_ids, output):
    if not allow_paid or not server.live_enabled:
        raise ValueError('Live calibration requires --allow-paid and LIVE_ENABLED=true')
    if not 1 <= max_calls <= 100:
        raise ValueError('Max calls must be between 1 and 100')
    selected = [case for case in dataset.cases if not case_ids or case.id in case_ids]
    if not selected or case_ids and set(case_ids) - {case.id for case in dataset.cases}:
        raise ValueError('Select known challenge IDs')
    # The operator explicitly selects this model; this is not a catalog/discovery assertion.
    pinned = judge_policy.snapshot(configuration, [configuration.model_id], server)
    pinned['configuration'].pop('max_claims_per_run')
    pinned['sampling'] = 'Selected challenge IDs in dataset order; ungraded cases are not correct predictions'
    key = credential(pinned, server)
    prepared = {case.id: prepare(case) for case in selected}
    manifest = {'version': 'judge-calibration-v1', 'dataset_version': dataset.version,
                'dataset_sha256': judge_policy.digest(dataset.model_dump(mode='json')),
                'case_ids': [case.id for case in selected], 'judge': pinned,
                'prompt_id': PROMPTS['judge'], 'max_calls': max_calls,
                'code_sha256': fingerprint()}
    report = {'mode': 'live-judge-calibration', 'created_at': datetime.now(timezone.utc).isoformat(),
              'manifest': manifest, 'status': 'running', 'calls': 0,
              'accounted_tokens': 0, 'estimated_cost_usd': 0 if pinned['cost_estimates_available'] else None,
              'results': [{'prediction': {'case_id': case.id, 'status': 'ungraded',
                  'judgment': None, 'reason': 'Not attempted'}} for case in selected]}
    persist(output, report, initial=True)
    judge = judge_policy.SemanticJudge(pinned, key)
    started = time.monotonic()
    stop = None
    for row, case in zip(report['results'], selected):
        content, bound, provenance = prepared[case.id]
        remaining = configuration.wall_seconds - (time.monotonic() - started)
        reservation = {'input_tokens': bound - judge_policy.OUTPUT_TOKENS,
                       'output_tokens': judge_policy.OUTPUT_TOKENS}
        cost = priced_tokens(reservation, pinned)
        if stop is None:
            if report['calls'] >= max_calls:
                stop = 'Call limit reached'
            elif remaining <= 0:
                stop = 'Time limit reached'
            elif report['accounted_tokens'] + bound > configuration.tokens:
                stop = 'Token reservation exceeds remaining budget'
            elif cost is not None and report['estimated_cost_usd'] + cost > configuration.estimated_cost_usd:
                stop = 'Cost reservation exceeds remaining budget'
        if stop:
            row['prediction']['reason'] = stop
            continue
        judge_policy.validate_snapshot(pinned)
        report['calls'] += 1
        report['accounted_tokens'] += bound
        if cost is not None:
            report['estimated_cost_usd'] += cost
        row.update({'provenance': provenance, 'reserved_tokens': bound,
                    'usage': None, 'estimated_cost_usd': cost})
        row['prediction'].update(status='reserved', reason='Call reserved; outcome may be unknown')
        persist(output, report)
        try:
            response = judge.invoke(content, timeout=remaining)
            if not isinstance(response, dict):
                raise ValueError('Invalid provider response')
        except Exception:
            row['prediction'].update(status='ungraded', reason='Call failed; reservation retained')
            stop = 'Stopped after an uncertain provider outcome; no automatic retry'
        else:
            usage = judge_policy.usage_counts(response.get('raw'))
            if usage is not None:
                row['usage'] = usage
                report['accounted_tokens'] += usage['total_tokens'] - bound
                actual_cost = priced_tokens(usage, pinned)
                if actual_cost is not None:
                    report['estimated_cost_usd'] += actual_cost - cost
                    row['estimated_cost_usd'] = actual_cost
                if usage['total_tokens'] > bound:
                    stop = 'Reported tokens exceeded the reservation; no more calls'
            try:
                if response.get('parsing_error') or response.get('parsed') is None:
                    raise ValueError('Invalid judgment')
                parsed = SemanticJudgment.model_validate(response['parsed'])
                safe = SemanticJudgment.model_validate(redact(parsed.model_dump(mode='json')))
                row['prediction'].update(status='graded', judgment=safe.model_dump(), reason='')
            except (ValueError, TypeError):
                row['prediction'].update(status='ungraded', reason='Judge output failed schema validation')
                stop = 'Stopped after invalid output; no automatic retry'
        report['scores'] = score(selected, [r['prediction'] for r in report['results']])
        persist(output, report)
    report['status'] = 'completed' if all(r['prediction']['status'] == 'graded' for r in report['results']) else 'partial'
    report['scores'] = score(selected, [r['prediction'] for r in report['results']])
    persist(output, report)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cases', type=Path, default=CASES)
    action = parser.add_mutually_exclusive_group()
    action.add_argument('--predictions', type=Path, help='Rescore a saved calibration report offline')
    action.add_argument('--live', action='store_true')
    parser.add_argument('--allow-paid', action='store_true')
    parser.add_argument('--model', help='Explicit server model ID, including anthropic: prefix if needed')
    parser.add_argument('--case', dest='case_ids', action='append')
    parser.add_argument('--max-calls', type=int, default=6)
    parser.add_argument('--tokens', type=int, default=24000)
    parser.add_argument('--wall-seconds', type=int, default=120)
    parser.add_argument('--max-cost-usd', type=float, default=.25)
    args = parser.parse_args(argv)
    try:
        dataset = load_cases(args.cases)
        if args.live:
            if not args.allow_paid or not args.model:
                raise ValueError('Live calibration requires --allow-paid and an explicit --model')
            configuration = JudgeConfiguration(model_id=args.model, tokens=args.tokens,
                wall_seconds=args.wall_seconds, estimated_cost_usd=args.max_cost_usd)
            output = RESULTS / 'judge-calibration' / f'{uuid4()}.json'
            report = run(dataset, configuration, settings(), allow_paid=True,
                         max_calls=args.max_calls, case_ids=args.case_ids, output=output)
            print(json.dumps({'path': str(output), 'status': report['status'], 'scores': report['scores']}, indent=2))
        elif args.predictions:
            report = json.loads(args.predictions.read_text())
            manifest = report['manifest']
            if manifest['dataset_sha256'] != judge_policy.digest(dataset.model_dump(mode='json')):
                raise ValueError('Prediction dataset fingerprint does not match')
            ids = manifest['case_ids']
            if not ids or len(set(ids)) != len(ids) or set(ids) - {c.id for c in dataset.cases}:
                raise ValueError('Prediction manifest has invalid case IDs')
            selected = [case for case in dataset.cases if case.id in ids]
            print(json.dumps(score(selected, [r['prediction'] for r in report['results']]), indent=2))
        else:
            print(json.dumps({'dataset': dataset.version, 'cases': len(dataset.cases),
                              'status': 'validated; no model calls',
                              'dataset_sha256': judge_policy.digest(dataset.model_dump(mode='json'))}, indent=2))
    except (ValidationError, KeyError, TypeError, json.JSONDecodeError):
        parser.exit(2, 'Invalid calibration data or configuration; values withheld.\n')
    except (OSError, ValueError):
        parser.exit(2, 'Calibration could not complete; check inputs, consent, server configuration and output storage.\n')


if __name__ == '__main__':
    main()
