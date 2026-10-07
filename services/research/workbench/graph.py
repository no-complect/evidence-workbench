import hashlib
import json
from datetime import datetime, timezone
from typing import Annotated, TypedDict
from uuid import NAMESPACE_URL, uuid5
from langgraph.graph import StateGraph, START, END
from langgraph.types import Send, interrupt
from . import db, budget
from .models import Plan, Assessment, Report, Claim
from .context import assemble, ContextOverflow
from .providers import DemoProvider, OpenAIProvider
from .retrieval import PostgresHybridRetriever
from .evidence import for_run, persist_report, verify
from .config import settings

from .reducers import merge_ids


class State(TypedDict, total=False):
    run_id: str
    plan: dict
    iteration: int
    pending: list[dict]
    evidence_ids: Annotated[list[str], merge_ids]
    task: dict
    assessment: dict
    report_key: str


class Runtime:

    def __init__(self, run):
        self.run = run
        self.provider = DemoProvider() if run['mode'] == 'demo' else OpenAIProvider()

    def effect(self, key, fn):
        budget.check(self.run)
        previous = db.one(
            'SELECT result FROM effects WHERE run_id=%s AND project_id=%s AND effect_key=%s',
            (self.run['id'], self.run['project_id'], key))
        if previous:
            return previous['result']
        result = fn()
        budget.check(self.run)
        db.execute(
            'INSERT INTO effects(run_id,project_id,effect_key,result) VALUES(%s,%s,%s,%s) ON CONFLICT DO NOTHING',
            (self.run['id'], self.run['project_id'], key, db.jsonb(result)))
        return result

    def model(self, stage, key, schema, summary=None):

        def call():
            try:
                payload, trace = assemble(stage, self.run['question'], for_run(self.run), summary)
            except ContextOverflow as exc:
                raise budget.BudgetExhausted(str(exc)) from exc
            trace['input_tokens_estimate'] += len(json.dumps(
                schema.model_json_schema()).encode()) + 256
            trace['schema_and_message_overhead_included'] = True
            reserve_tokens = trace['input_tokens_estimate'] + trace['output_token_reservation']
            s = settings()
            cost = 0 if self.run['mode'] == 'demo' else (
                trace['input_tokens_estimate'] * s.model_input_usd_per_million +
                2200 * s.model_output_usd_per_million) / 1_000_000
            call_key = f"{key}/attempt-{self.run['attempts']}"
            budget.reserve(self.run, call_key, tokens=reserve_tokens, cost=cost)
            db.execute(
                'INSERT INTO contexts(id,run_id,project_id,call_key,stage,payload) VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT(run_id,call_key) DO NOTHING',
                (db.uid(), self.run['id'], self.run['project_id'], call_key, stage,
                 db.jsonb(trace)))
            result, actual, actual_cost = self.provider.invoke(
                stage,
                payload,
                schema,
                timeout=max(
                    0.1, min(35,
                             (self.run['deadline'] - datetime.now(timezone.utc)).total_seconds())))
            # Demo counts assembled fixture bytes as estimated tokens, not provider usage.
            budget.reconcile(self.run, call_key, actual, actual_cost)
            db.event(
                self.run, key, stage, f'{stage.title()} completed', {
                    'provider': self.provider.name,
                    'estimated_tokens_reserved': reserve_tokens,
                    'actual_tokens': actual,
                    'cost_known': self.run['mode'] == 'demo' or actual_cost is not None
                })
            return result.model_dump(mode='json')

        return schema.model_validate(self.effect(key, call))


def build_graph(run, checkpointer):
    rt = Runtime(run)

    def validate(state):
        budget.check(run)
        db.event(run, 'validate', 'validate', 'Request and collection scope validated')
        return {'iteration': 0, 'evidence_ids': []}

    def plan(state):
        result = rt.model('plan', 'plan', Plan)
        if run['strategy'] == 'rag':
            result.tasks = result.tasks[:1]
            result.tasks[0].question = run['question']
        db.execute('UPDATE research_runs SET plan=%s WHERE id=%s',
                   (db.jsonb(result.model_dump()), run['id']))
        return {'plan': result.model_dump()}

    def approve(state):
        chosen = state['plan']
        if run['request']['approve_plan']:
            chosen = Plan.model_validate(
                interrupt({
                    'plan': chosen,
                    'message': 'Review, edit and approve the research plan'
                })).model_dump()
        db.execute('UPDATE research_runs SET plan=%s WHERE id=%s', (db.jsonb(chosen), run['id']))
        db.event(run, 'approve', 'approve', 'Research plan approved',
                 {'tasks': len(chosen['tasks'])})
        return {'plan': chosen, 'pending': chosen['tasks']}

    def dispatch(state):
        iteration = state['iteration'] + 1
        budget.check(run)
        db.event(run, f'dispatch/{iteration}', 'dispatch',
                 f'Dispatching {len(state["pending"])} research tasks', {
                     'iteration': iteration,
                     'concurrency': run['request']['limits']['concurrency']
                 })
        return {'iteration': iteration}

    def send_tasks(state):
        return [
            Send('gather', {
                'task': t,
                'iteration': state['iteration']
            }) for t in state['pending']
        ]

    def gather(state):
        task = state['task']
        iteration = state['iteration']
        key = f'gather/{iteration}/{task["id"]}'

        def call():
            call_key = f'{key}/attempt-{run["attempts"]}'
            # Query embeddings are separately budgeted as one tool plus worst-case input tokens.
            tokens = 0 if run['mode'] == 'demo' else len(task['question'].encode())
            cost = 0 if run['mode'] == 'demo' else tokens * settings(
            ).embedding_usd_per_million / 1_000_000
            budget.reserve(run, call_key, tokens=tokens, tools=1, cost=cost)
            retriever = PostgresHybridRetriever(project_id=str(run['project_id']),
                                                collection_id=str(run['collection_id']),
                                                top_k=run['request']['limits']['top_k'],
                                                version_ids=run['corpus_versions'])
            docs = retriever.invoke(task['question'])
            budget.reconcile(run, call_key)
            ids = []
            for doc in docs:
                item = doc.metadata
                eid = str(uuid5(NAMESPACE_URL, f"{run['id']}/{item['chunk']['id']}"))
                db.execute(
                    'INSERT INTO evidence(id,run_id,project_id,chunk_id,scores) VALUES(%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING',
                    (eid, run['id'], run['project_id'], item['chunk']['id'],
                     db.jsonb({
                         'rrf': item['rrf'],
                         'ranks': item['ranks'],
                         'reranker': item['reranker']
                     })))
                ids.append(eid)
            if run['request'].get('web_enabled'):
                ids.extend(gather_web(run, task, key))
            db.execute(
                'INSERT INTO research_tasks(id,run_id,project_id,iteration,question,evidence_ids) VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING',
                (task['id'], run['id'], run['project_id'], iteration, task['question'],
                 db.jsonb(ids)))
            db.event(run, key, 'gather', f'Read evidence for {task["topic"]}', {
                'task': task,
                'evidence_ids': ids,
                'iteration': iteration
            })
            return ids

        return {'evidence_ids': rt.effect(key, call)}

    def assess(state):
        key = f'assess/{state["iteration"]}'
        result = rt.model('assess', key, Assessment, {
            'topics': [t['topic'] for t in state['plan']['tasks']],
            'iteration': state['iteration']
        })
        return {
            'assessment': result.model_dump(),
            'pending': [t.model_dump() for t in result.followups]
        }

    def after_assess(state):
        if run['strategy'] == 'agent' and state['pending'] and state['iteration'] < run['request'][
                'limits']['iterations']:
            return 'dispatch'
        return 'synthesize'

    def synthesize(state):
        result = rt.model('report', 'report', Report, state['assessment'])
        if state['pending'] and run['strategy'] == 'agent' and state['iteration'] >= run['request'][
                'limits']['iterations']:
            result.partial = True
            result.limitations.append('Iteration limit reached with follow-up questions remaining.')
        db.execute(
            'INSERT INTO effects(run_id,project_id,effect_key,result) VALUES(%s,%s,%s,%s) ON CONFLICT(run_id,effect_key) DO UPDATE SET result=excluded.result',
            (run['id'], run['project_id'], 'final-report', db.jsonb(
                result.model_dump(mode='json'))))
        return {'report_key': 'final-report'}

    def verify_node(state):
        result = Report.model_validate(
            db.one('SELECT result FROM effects WHERE run_id=%s AND effect_key=%s',
                   (run['id'], state['report_key']))['result'])
        verify(run, result)
        persist_report(run, result)
        db.event(
            run, 'verify', 'verify',
            'Citation existence, project access and exact-quote checks passed', {
                'claims':
                len(result.claims),
                'semantic_support':
                'exact substring checks for direct quotes; model-assessed claims need human review'
            })
        return {}

    def finalize(state):
        budget.check(run)
        row = db.scoped_run(run['id'], run['project_id'])
        status = 'partial' if row['report']['partial'] else 'completed'
        db.execute(
            'UPDATE research_runs SET status=%s,updated_at=now() WHERE id=%s AND lease_owner=%s',
            (status, run['id'], run['lease_owner']))
        db.event(run, 'finalize', 'finalize', 'Report ready', {'status': status})
        return {}

    graph = StateGraph(State)
    for name, fn in [('validate', validate), ('plan', plan), ('approve', approve),
                     ('dispatch', dispatch), ('gather', gather), ('assess', assess),
                     ('synthesize', synthesize), ('verify', verify_node), ('finalize', finalize)]:
        graph.add_node(name, fn)
    graph.add_edge(START, 'validate')
    graph.add_edge('validate', 'plan')
    graph.add_edge('plan', 'approve')
    graph.add_edge('approve', 'dispatch')
    graph.add_conditional_edges('dispatch', send_tasks, ['gather'])
    graph.add_edge('gather', 'assess')
    graph.add_conditional_edges('assess', after_assess, ['dispatch', 'synthesize'])
    graph.add_edge('synthesize', 'verify')
    graph.add_edge('verify', 'finalize')
    graph.add_edge('finalize', END)
    return graph.compile(checkpointer=checkpointer)


def gather_web(run, task, key):
    from datetime import datetime, timezone
    from .webtools import TavilySearch, fetch_page, WebPolicyError
    from .ingest import ingest
    from .config import settings
    skey = f'{key}/web/{run["attempts"]}'
    budget.reserve(run, skey, tools=1, cost=settings().web_search_usd_per_call)
    results = TavilySearch().search(task['question'])
    budget.reconcile(run, skey)
    ids = []
    for i, item in enumerate(results):
        fkey = f'{skey}/fetch/{i}'
        budget.reserve(run, fkey, tools=1)
        try:
            page = fetch_page(item['url'])
        except WebPolicyError as exc:
            db.event(run, fkey, 'fetch', str(exc))
            continue
        budget.reconcile(run, fkey)
        name = 'web-' + hashlib.sha256(page['url'].encode()).hexdigest()[:24] + '.txt'
        result = ingest(run['project_id'],
                        run['collection_id'],
                        name,
                        page['text'].encode(), {
                            'source_url': page['url'],
                            'fetched_at': datetime.now(timezone.utc).isoformat(),
                            'synthetic': False,
                            'truncated': page['truncated']
                        },
                        embed=False)
        for chunk in db.all_rows(
                'SELECT id FROM chunks WHERE version_id=%s AND project_id=%s ORDER BY ordinal LIMIT 3',
            (result['version_id'], run['project_id'])):
            eid = str(uuid5(NAMESPACE_URL, f"{run['id']}/{chunk['id']}"))
            db.execute(
                'INSERT INTO evidence(id,run_id,project_id,chunk_id,scores) VALUES(%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING',
                (eid, run['id'], run['project_id'], chunk['id'],
                 db.jsonb({
                     'web': True,
                     'rrf': 0,
                     'reranker': 'disabled'
                 })))
            ids.append(eid)
    return ids


def partial_report(run, reason):
    claims = [
        Claim(text=e['text'], evidence_ids=[e['id']], support='direct_quote') for e in for_run(run)
        if not e['metadata'].get('untrusted_instructions') and len(e['text']) > 85
        and not e['text'].startswith('#')
    ][:8]
    report = Report(
        title='Partial research report',
        summary=
        'Execution stopped at a configured limit. The excerpts below preserve evidence gathered so far; synthesis is incomplete.',
        claims=claims,
        limitations=[
            reason,
            'No further inference was attempted after the limit. Excerpts may be incomplete or contradictory.'
        ],
        partial=True)
    persist_report(run, report)
    db.execute(
        "UPDATE research_runs SET status='partial',error=%s,updated_at=now() WHERE id=%s AND lease_owner=%s",
        (reason, run['id'], run['lease_owner']))
    db.event(run, 'budget-stop', 'budget', reason)
