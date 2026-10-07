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
from .api import create_run
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


def run_evaluation(split='all'):
    if settings().app_env not in {'local', 'test'} or settings().auth_mode != 'demo':
        raise ValueError('Fixture evaluations run only in local/test demo configuration')
    cases = json.loads((ROOT / 'evals/cases.json').read_text())['cases']
    selected = [
        c for c in cases if 'question_index' in c and (split == 'all' or c['split'] == split)
    ]
    if not selected:
        raise ValueError('No research cases selected')
    corpus_hash = hashlib.sha256((ROOT / 'fixtures/manifest.json').read_bytes()).hexdigest()
    versions = {
        'code_sha256': fingerprint(),
        'corpus_sha256': corpus_hash,
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
    # Freeze a dedicated collection from the fixture manifest; never benchmark mutable user uploads.
    from .ingest import ingest, MANIFEST
    evaluation_collection = db.uid()
    db.execute(
        "INSERT INTO collections(id,project_id,name,embedding_config) VALUES(%s,%s,%s,'demo-v1')",
        (evaluation_collection, DEMO_PROJECT, 'Evaluation snapshot ' + evaluation_collection[:8]))
    for metadata in MANIFEST['documents']:
        source = ROOT / 'fixtures/corpus' / metadata['file']
        ingest(DEMO_PROJECT, evaluation_collection, source.name, source.read_bytes(), metadata)
    versions['collection_id'] = evaluation_collection
    versions['source_hashes'] = [
        r['content_hash'] for r in db.all_rows(
            'SELECT v.content_hash FROM source_versions v JOIN source_documents d ON d.id=v.document_id WHERE d.collection_id=%s ORDER BY d.name',
            (evaluation_collection, ))
    ]
    raw = []
    for strategy in STRATEGIES:
        for case in selected:
            request = RunCreate(collection_id=evaluation_collection,
                                question=EXAMPLES[case['question_index']],
                                strategy=strategy,
                                approve_plan=False,
                                limits=case.get('limits', {}),
                                idempotency_key=db.uid())
            started = time.monotonic()
            run = create_run(DEMO_PROJECT, request, DEMO_USER)
            while time.monotonic() - started < 180:
                run = db.scoped_run(run['id'], DEMO_PROJECT)
                if run['status'] in {'completed', 'failed', 'partial', 'cancelled'}:
                    break
                time.sleep(.15)
            else:
                raise TimeoutError(
                    'Worker did not finish evaluation; start the worker and inspect its logs')
            elapsed = time.monotonic() - started
            evidence = for_run(run)
            available = {str(e['id']): e for e in evidence}
            claims = (run['report'] or {}).get('claims', [])
            cited = [(c, eid) for c in claims for eid in c['evidence_ids']]
            valid = sum(eid in available for _, eid in cited)
            quotes = [(c, eid) for c, eid in cited if c['support'] == 'direct_quote']
            supported = sum(eid in available and c['text'] in available[eid]['text']
                            for c, eid in quotes)
            retrieval = search(DEMO_PROJECT, evaluation_collection, case['query'], 5,
                               run['corpus_versions'])
            ranked = [x['chunk']['source_name'] for x in retrieval]
            relevant = set(case['relevant_sources'])
            recall = len(set(ranked) & relevant) / len(relevant)
            mrr = next((1 / (i + 1) for i, x in enumerate(ranked) if x in relevant), 0.)
            topics = {
                t
                for c, eid in cited if eid in available
                for t in available[eid]['metadata'].get('topics', [])
            }
            required = set(case['required_topics'])
            checks = {}
            text = json.dumps(run['report'])
            if case.get('must_disclose'):
                checks['disclosure'] = case['must_disclose'] in text
            if case.get('forbidden_claim'):
                checks['injection_resisted'] = all(case['forbidden_claim'] not in c['text']
                                                   for c in claims)
            item = {
                'case': case['id'],
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
                'estimated_cost_usd': float(run['cost_used']),
                'limits': request.limits.model_dump()
            }
            raw.append(item)
            print(f'{strategy:8} {case["id"]:25} {run["status"]:10} {elapsed:.2f}s', flush=True)
    aggregate = []
    for strategy in STRATEGIES:
        rows = [r for r in raw if r['strategy'] == strategy]
        aggregate.append({
            'strategy':
            strategy,
            'cases':
            len(rows),
            'recall_at_k':
            mean([r['recall_at_k'] for r in rows]),
            'mrr':
            mean([r['mrr'] for r in rows]),
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
            sum(r['estimated_cost_usd'] for r in rows)
        })
    eid = db.uid()
    db.execute(
        'INSERT INTO evaluation_runs(id,project_id,mode,versions,results) VALUES(%s,%s,%s,%s,%s)',
        (eid, DEMO_PROJECT, 'demo', db.jsonb(versions), db.jsonb(aggregate)))
    out = ROOT / 'evals/results'
    out.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    (out / f'{stamp}-{eid}.json').write_text(
        json.dumps(
            {
                'id': eid,
                'mode': 'demo',
                'versions': versions,
                'raw': raw,
                'aggregate': aggregate
            },
            indent=2) + '\n')
    lines = [
        '# Measured fixture comparison', '',
        f'Evaluation {eid}; split {split}. Scripted responses, synthetic sources, real Postgres and graph execution.',
        '',
        '| Strategy | Cases | Recall@5 | MRR | Citation existence/access | Quote substring support | Completion | Mean seconds |',
        '|---|---:|---:|---:|---:|---:|---:|---:|'
    ]
    for row in aggregate:
        support = 'n/a' if row['quote_support'] is None else f"{row['quote_support']:.3f}"
        lines.append(
            f"| {row['strategy']} | {row['cases']} | {row['recall_at_k']:.3f} | {row['mrr']:.3f} | {row['citation_validity']:.3f} | {support} | {row['completion_rate']:.3f} | {row['mean_latency_seconds']:.3f} |"
        )
    lines += [
        '',
        'Recall/MRR use the same independent retrieval probe for each strategy; they do not establish an agent advantage. Completion includes intentional budget-stop cases. Quote checks are lexical support for literal excerpts, not an independent semantic assessment of synthesized claims. Reliability and isolation cases are separate integration tests. No live model quality claims.',
        '', '```json',
        json.dumps(versions, indent=2), '```'
    ]
    (out / f'{stamp}-{eid}.md').write_text('\n'.join(lines) + '\n')
    print(f'Saved evaluation {eid} and raw results to evals/results')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--split', choices=['all', 'development', 'held-out'], default='all')
    args = parser.parse_args()
    run_evaluation(args.split)
