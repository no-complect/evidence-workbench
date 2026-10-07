from datetime import datetime, timezone
from . import db


class BudgetExhausted(Exception):
    pass


class Cancelled(Exception):
    pass


class LeaseLost(Exception):
    pass


def check(run):
    row = db.scoped_run(run['id'], run['project_id'])
    if row['cancel_requested']:
        raise Cancelled('Cancelled by user')
    if row['lease_owner'] != run['lease_owner'] or (row['lease_until'] and row['lease_until']
                                                    < datetime.now(timezone.utc)):
        raise LeaseLost('Worker lease lost')
    if row['deadline'] and row['deadline'] < datetime.now(timezone.utc):
        raise BudgetExhausted('Wall-clock limit reached')
    limits = row['request']['limits']
    if row['tokens_used'] > limits['tokens'] or row['tools_used'] > limits['tool_calls'] or float(
            row['cost_used']) > limits['estimated_cost_usd']:
        raise BudgetExhausted(
            'Reported usage exceeded its conservative reservation; further work stopped')
    return row


def reserve(run, key, tokens=0, tools=0, cost=0.0):
    check(run)
    with db.connection() as conn:
        row = conn.execute('SELECT * FROM research_runs WHERE id=%s AND project_id=%s FOR UPDATE',
                           (run['id'], run['project_id'])).fetchone()
        if row['cancel_requested']:
            raise Cancelled('Cancelled by user')
        if row['lease_owner'] != run['lease_owner']:
            raise LeaseLost('Worker lease lost')
        if row['deadline'] < datetime.now(timezone.utc):
            raise BudgetExhausted('Wall-clock limit reached')
        prior = conn.execute('SELECT * FROM usage_records WHERE run_id=%s AND call_key=%s',
                             (run['id'], key)).fetchone()
        if prior:
            # A reservation without a result is not evidence that the provider was never called.
            raise BudgetExhausted(
                'Uncertain prior call; reservation retained to avoid unbudgeted replay')
        limits = row['request']['limits']
        if row['tokens_used'] + tokens > limits['tokens'] or row['tools_used'] + tools > limits[
                'tool_calls'] or float(row['cost_used']) + cost > limits['estimated_cost_usd']:
            raise BudgetExhausted('Token, tool-call or estimated-cost limit reached')
        conn.execute(
            'UPDATE research_runs SET tokens_used=tokens_used+%s,tools_used=tools_used+%s,cost_used=cost_used+%s WHERE id=%s',
            (tokens, tools, cost, run['id']))
        conn.execute(
            'INSERT INTO usage_records(id,run_id,project_id,call_key,tokens,tool_calls,estimated_cost) VALUES(%s,%s,%s,%s,%s,%s,%s)',
            (db.uid(), run['id'], run['project_id'], key, tokens, tools, cost))


def reconcile(run, key, actual_tokens=None, actual_cost=None):
    with db.connection() as conn:
        conn.execute('SELECT id FROM research_runs WHERE id=%s FOR UPDATE', (run['id'], ))
        row = conn.execute('SELECT * FROM usage_records WHERE run_id=%s AND call_key=%s FOR UPDATE',
                           (run['id'], key)).fetchone()
        if not row or row['status'] == 'complete':
            return
        tokens = row['tokens'] if actual_tokens is None else actual_tokens
        cost = float(row['estimated_cost']) if actual_cost is None else actual_cost
        conn.execute(
            "UPDATE usage_records SET actual_tokens=%s,actual_cost=%s,status='complete' WHERE id=%s",
            (actual_tokens, actual_cost, row['id']))
        conn.execute(
            'UPDATE research_runs SET tokens_used=tokens_used+%s,cost_used=cost_used+%s WHERE id=%s',
            (tokens - row['tokens'], cost - float(row['estimated_cost']), run['id']))
