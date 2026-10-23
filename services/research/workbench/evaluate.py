"""Fixture comparison harness. No paid live evaluation unless a separate operator adds it."""
import argparse
import hashlib
import json
import statistics
import time
from datetime import datetime, timezone
from . import db
from .config import ROOT, DEMO_PROJECT, DEMO_USER, settings
from .models import EXAMPLES, RunCreate
from .runs import create_run
from .retrieval import search
from .evidence import for_run

STRATEGIES = ['rag', 'workflow', 'agent']


def mean(values):
    return statistics.mean(values) if values else None


def fingerprint():
    files = sorted(
        p for directory in
        ['services/research/workbench', 'prompts', 'db/migrations', 'packages/contracts']
        for p in (ROOT / directory).rglob('*') if p.is_file() and '__pycache__' not in str(p))
    return hashlib.sha256(b''.join(
        str(p.relative_to(ROOT)).encode() + p.read_bytes() for p in files)).hexdigest()


def run_evaluation(split='all', *, project_id=DEMO_PROJECT, user_id=DEMO_USER,
                   evaluation_id=None, collection_id=None, progress=None, check_active=None, custom=None, judge_lease_owner=None):
    if not custom and (settings().app_env not in {'local', 'test'} or settings().auth_mode != 'demo'):
        raise ValueError('Fixture evaluations run only in local/test demo configuration')
    evaluation_id = evaluation_id or db.uid()
    check_active = check_active or (lambda: None)
    progress = progress or (lambda value: None)
    check_active()
    cases = json.loads((ROOT / 'evals/cases.json').read_text())['cases']
    selected = [
        c for c in cases if 'question_index' in c and (split == 'all' or c['split'] == split)
    ]
    if custom:
        selected = [{'id': f'custom-{i+1}', 'split': split, 'question': case['question'], 'query': case['query'],
                     'relevant_sources': case['expected_sources'], 'required_topics': [],
                     'must_disclose': case.get('expected_disclosure', ''), 'expect_no_evidence': case.get('expect_no_evidence', False)} for i, case in enumerate(custom['cases'])]
    if not selected:
        raise ValueError('No research cases selected')
    corpus_hash = hashlib.sha256((ROOT / 'fixtures/manifest.json').read_bytes()).hexdigest()
    versions = {
        'code_sha256': fingerprint(),
        'corpus_sha256': corpus_hash,
        'cases_sha256': hashlib.sha256((ROOT / 'evals/cases.json').read_bytes()).hexdigest(),
        'case_ids': [case['id'] for case in selected],
        'corpus': 'synthetic-corpus-v1',
        'model': 'deterministic-fixture-v1',
        'embedding': 'fixture-topic-vector-v1/16',
        'prompt_hashes': {
            p.name: hashlib.sha256(p.read_bytes()).hexdigest()
            for p in (ROOT / 'prompts').glob('*.md')
        },
        'context_policy': 'context-v1',
        'split': split,
        'token_accounting': 'conservative reservations; no provider tokens in demo',
        'semantic_judge': 'none; exact quote substring checks only',
        'relevance_granularity': 'manually labeled documents',
        'system_cases': 'Separate integration tests; not silently counted as passed by this harness'
    }
    if custom:
        evaluation_collection = str(custom['collection_id'])
        source_hashes = db.all_rows('SELECT id,content_hash FROM source_versions WHERE id=ANY(%s::uuid[]) AND project_id=%s ORDER BY id', (custom['version_ids'], project_id))
        versions.update({'collection_id': evaluation_collection, 'corpus': 'user-collection-snapshot',
            'corpus_sha256': hashlib.sha256(json.dumps([(str(r['id']), r['content_hash']) for r in source_hashes]).encode()).hexdigest(),
            'cases_sha256': hashlib.sha256(json.dumps(custom['cases'], sort_keys=True).encode()).hexdigest(),
            'source_hashes': [r['content_hash'] for r in source_hashes],
            'harness_snapshot': custom.get('model_snapshot'),
            'retrieval_measurement': 'top five retained evidence passages ordered by RRF then ID; document-level labels',
            'token_accounting': 'per-run token reservations and provider usage when reported',
            'source_version_ids': custom['version_ids'], 'expectations': custom['cases'],
            'model': (custom.get('model_snapshot') or {}).get('targets', 'deterministic-fixture-v1'),
            'harness_configuration': custom.get('harness_config'),
            'embedding': db.one('SELECT embedding_config FROM collections WHERE id=%s', (evaluation_collection,))['embedding_config']})
    else:
        # Freeze a dedicated collection from the fixture manifest; never benchmark mutable user uploads.
        from .ingest import ingest, MANIFEST
        evaluation_collection = collection_id or db.uid()
        db.execute(
            "INSERT INTO collections(id,project_id,name,embedding_config,read_only) VALUES(%s,%s,%s,'demo-v1',true) ON CONFLICT(id) DO NOTHING",
            (evaluation_collection, project_id, 'Evaluation snapshot ' + evaluation_collection[:8]))
        for metadata in MANIFEST['documents']:
            check_active()
            source = ROOT / 'fixtures/corpus' / metadata['file']
            ingest(project_id, evaluation_collection, source.name, source.read_bytes(), metadata)
        versions['collection_id'] = evaluation_collection
        versions['source_hashes'] = [
            r['content_hash'] for r in db.all_rows(
                'SELECT v.content_hash FROM source_versions v JOIN source_documents d ON d.id=v.document_id WHERE d.collection_id=%s ORDER BY d.name',
                (evaluation_collection, ))
        ]
    raw = []
    total = len(STRATEGIES) * len(selected)
    progress({'completed': 0, 'total': total, 'stage': 'cases'})
    for strategy in STRATEGIES:
        for case in selected:
            check_active()
            request = RunCreate(collection_id=evaluation_collection,
                                question=case['question'] if custom else EXAMPLES[case['question_index']],
                                mode=custom['mode'] if custom else 'demo',
                                model_id=custom.get('model_id') if custom else None,
                                harness_config=custom.get('harness_config') if custom else None,
                                strategy=strategy,
                                approve_plan=False,
                                limits=custom['limits'] if custom else case.get('limits', {}),
                                idempotency_key=f'eval/{evaluation_id}/{strategy}/{case["id"]}')
            started = time.monotonic()
            run = create_run(project_id, request, user_id,
                             evaluation_job_id=evaluation_id if collection_id else None,
                             pinned_harness=custom.get('model_snapshot') if custom else None,
                             version_ids=custom['version_ids'] if custom else None)
            while time.monotonic() - started < 180:
                check_active()
                run = db.scoped_run(run['id'], project_id)
                if run['status'] in {'completed', 'failed', 'partial', 'cancelled'}:
                    break
                time.sleep(.15)
            else:
                raise TimeoutError(
                    'Worker did not finish evaluation; start the worker and inspect its logs')
            elapsed = max(0., (run['updated_at'] - run['created_at']).total_seconds())
            evidence = for_run(run)
            available = {str(e['id']): e for e in evidence}
            claims = (run['report'] or {}).get('claims', [])
            cited = [(c, eid) for c in claims for eid in c['evidence_ids']]
            valid = sum(eid in available for _, eid in cited)
            quotes = [(c, eid) for c, eid in cited if c['support'] == 'direct_quote']
            supported = sum(eid in available and c['text'] in available[eid]['text']
                            for c, eid in quotes)
            if custom:
                # Evaluate retained retrieval evidence; do not make unbudgeted embedding calls after a run.
                ranked = [e['source_name'] for e in sorted(evidence, key=lambda e: (-float(e['scores'].get('rrf', 0)), str(e['id'])))[:5]]
            else:
                retrieval = search(project_id, evaluation_collection, case['query'], 5,
                                   run['corpus_versions'])
                ranked = [x['chunk']['source_name'] for x in retrieval]
            relevant = set(case['relevant_sources'])
            recall = len(set(ranked) & relevant) / len(relevant) if relevant else None
            mrr = next((1 / (i + 1) for i, x in enumerate(ranked) if x in relevant), 0.) if relevant else None
            topics = {
                t
                for c, eid in cited if eid in available
                for t in available[eid]['metadata'].get('topics', [])
            }
            required = set(case['required_topics'])
            checks = {}
            if case.get('expect_no_evidence'):
                checks['abstained_without_claims'] = not claims
            text = json.dumps(run['report'])
            if case.get('must_disclose'):
                checks['disclosure'] = case['must_disclose'].casefold() in text.casefold()
            if case.get('forbidden_claim'):
                checks['injection_resisted'] = all(case['forbidden_claim'] not in c['text']
                                                   for c in claims)
            item = {
                'case': case['id'],
                'question': request.question,
                'expected_sources': case['relevant_sources'],
                'expected_disclosure': case.get('must_disclose', ''),
                'expect_no_evidence': case.get('expect_no_evidence', False),
                'split': case['split'],
                'strategy': strategy,
                'run_id': str(run['id']),
                'status': run['status'],
                'recall_at_k': recall,
                'mrr': mrr,
                'ranked_sources': ranked,
                'citation_validity': valid / len(cited) if cited else None,
                'quote_support': supported / len(quotes) if quotes else None,
                'question_coverage': len(topics & required) / len(required) if required else None,
                'claims': len(claims),
                'checks': checks,
                'tokens': run['tokens_used'],
                'latency_seconds': elapsed,
                'estimated_cost_usd': None if (run.get('harness_snapshot') or {}).get('cost_estimates_available') is False else float(run['cost_used']),
                'limits': request.limits.model_dump()
            }
            raw.append(item)
            progress({'completed': len(raw), 'total': total, 'stage': 'cases',
                      'strategy': strategy, 'case': case['id']})
            print(f'{strategy:8} {case["id"]:25} {run["status"]:10} {elapsed:.2f}s', flush=True)
    if custom and custom.get('judge_snapshot'):
        from .judging import grade_run
        pinned = custom['judge_snapshot']
        versions['semantic_judge'] = pinned
        for i, row in enumerate(raw):
            check_active()
            progress({'completed': len(raw), 'total': total, 'stage': 'judging',
                      'judged_runs': i, 'strategy': row['strategy'], 'case': row['case']})
            row['judging'] = grade_run(evaluation_id, project_id, judge_lease_owner,
                db.scoped_run(row['run_id'], project_id), pinned, check_active)
        charged = db.one('SELECT coalesce(sum(tokens_charged),0) AS tokens,'
            'coalesce(sum(cost_charged),0) AS cost FROM evaluation_judgments '
            'WHERE evaluation_job_id=%s AND project_id=%s', (evaluation_id, project_id))
        versions['judge_accounting'] = {'tokens_charged': int(charged['tokens']),
            'estimated_cost_usd': float(charged['cost']) if pinned['cost_estimates_available'] else None,
            'scope': 'separate from research cost aggregates; missing usage and uncertain calls retain reservations'}
    aggregate = []
    for strategy in STRATEGIES:
        rows = [r for r in raw if r['strategy'] == strategy]
        aggregate.append({
            'strategy':
            strategy,
            'cases':
            len(rows),
            'recall_at_k':
            mean([r['recall_at_k'] for r in rows if r['recall_at_k'] is not None]),
            'mrr':
            mean([r['mrr'] for r in rows if r['mrr'] is not None]),
            'citation_validity':
            mean([r['citation_validity'] for r in rows if r['citation_validity'] is not None])
            or 0.,
            'quote_support':
            mean([r['quote_support'] for r in rows if r['quote_support'] is not None]),
            'question_coverage':
            mean([r['question_coverage'] for r in rows if r['question_coverage'] is not None]),
            'completion_rate':
            mean([r['status'] == 'completed' for r in rows]),
            'mean_tokens':
            mean([r['tokens'] for r in rows]),
            'mean_latency_seconds':
            mean([r['latency_seconds'] for r in rows]),
            'estimated_cost_usd':
            sum(r['estimated_cost_usd'] for r in rows) if all(r['estimated_cost_usd'] is not None for r in rows) else None
        })
    check_active()
    eid = evaluation_id
    db.execute(
        'INSERT INTO evaluation_runs(id,project_id,mode,versions,results,raw) VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO NOTHING',
        (eid, project_id, custom['mode'] if custom else 'demo', db.jsonb(versions), db.jsonb(aggregate), db.jsonb(raw)))
    out = ROOT / 'evals/results'
    out.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    (out / f'{stamp}-{eid}.json').write_text(
        json.dumps(
            {
                'id': eid,
                'mode': custom['mode'] if custom else 'demo',
                'versions': versions,
                'raw': raw,
                'aggregate': aggregate
            },
            indent=2) + '\n')
    lines = [
        '# Measured fixture comparison', '',
        f'Evaluation {eid}; split {split}; mode {custom["mode"] if custom else "demo"}. See the pinned manifest for corpus, model and measurement definitions.',
        '',
        '| Strategy | Cases | Recall@5 | MRR | Citation existence/access | Quote substring support | Completion | Mean seconds |',
        '|---|---:|---:|---:|---:|---:|---:|---:|'
    ]
    for row in aggregate:
        recall_text = 'n/a' if row['recall_at_k'] is None else f"{row['recall_at_k']:.3f}"
        mrr_text = 'n/a' if row['mrr'] is None else f"{row['mrr']:.3f}"
        support = 'n/a' if row['quote_support'] is None else f"{row['quote_support']:.3f}"
        lines.append(
            f"| {row['strategy']} | {row['cases']} | {recall_text} | {mrr_text} | {row['citation_validity']:.3f} | {support} | {row['completion_rate']:.3f} | {row['mean_latency_seconds']:.3f} |"
        )
    lines += [
        '',
        'Collection evaluations measure retained run evidence; fixture benchmarks use an independent retrieval probe. Completion includes intentional budget stops. Quote and disclosure checks are lexical, not independent semantic judgments. Reliability and isolation are separate integration tests.',
        '', '```json',
        json.dumps(versions, indent=2), '```'
    ]
    (out / f'{stamp}-{eid}.md').write_text('\n'.join(lines) + '\n')
    print(f'Saved evaluation {eid} and raw results to evals/results')
    return eid


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--split', choices=['all', 'development', 'held-out'], default='all')
    args = parser.parse_args()
    run_evaluation(args.split)
