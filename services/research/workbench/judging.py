"""Durable, budgeted claim grading. A reserved external call is never replayed."""

from . import db, judge_policy
from .config import settings
from .context import redact
from .evidence import for_run
from .model_targets import credential as environment_credential
from .models import Report, SemanticJudgment


def public_rows(evaluation_id, project_id, run_id=None):
    scope = 'evaluation_job_id=%s AND project_id=%s'
    args = [evaluation_id, project_id]
    if run_id:
        scope += ' AND run_id=%s'
        args.append(run_id)
    rows = db.all_rows(
        'SELECT id,run_id,claim_index,request,status,result,token_bound,'
        'tokens_charged,created_at FROM evaluation_judgments WHERE '
        + scope
        + ' ORDER BY created_at,claim_index',
        tuple(args),
    )
    return db.serial(rows)


def reserve(evaluation_id, project_id, owner, run_id, index, request, bound, pinned, check_active):
    rates = [pinned['input_usd_per_million'], pinned['output_usd_per_million']]
    known = pinned['cost_estimates_available']
    cost = (
        ((bound - judge_policy.OUTPUT_TOKENS) * rates[0] + judge_policy.OUTPUT_TOKENS * rates[1])
        / 1_000_000
        if known
        else 0
    )
    limits = pinned['configuration']
    with db.connection() as conn:
        job = conn.execute(
            'SELECT id FROM evaluation_jobs WHERE id=%s AND project_id=%s '
            "AND lease_owner=%s AND status='running' AND NOT cancel_requested "
            'AND lease_until>clock_timestamp() FOR UPDATE',
            (evaluation_id, project_id, owner),
        ).fetchone()
        if not job:
            check_active()
            raise ValueError('Judge reservation requires an active evaluation lease')
        prior = conn.execute(
            'SELECT * FROM evaluation_judgments WHERE evaluation_job_id=%s '
            'AND run_id=%s AND claim_index=%s',
            (evaluation_id, run_id, index),
        ).fetchone()
        if prior:
            if prior['request'] != request:
                raise ValueError('Saved judge input changed during recovery')
            if prior['status'] == 'reserved':
                # Billing may have happened before the previous process stopped.
                prior = conn.execute(
                    "UPDATE evaluation_judgments SET status='ungraded',result=%s,"
                    'updated_at=now() WHERE id=%s RETURNING *',
                    (
                        db.jsonb(
                            {
                                'status': 'ungraded',
                                'reason': 'Previous call outcome is uncertain; reservation retained and call not retried',
                                'usage': None,
                                'estimated_cost_usd': float(prior['cost_charged'])
                                if known
                                else None,
                                'cost_source': 'reservation at pinned rates'
                                if known
                                else 'unavailable',
                            }
                        ),
                        prior['id'],
                    ),
                ).fetchone()
            return prior, False, 0
        used = conn.execute(
            'SELECT coalesce(sum(tokens_charged),0) AS tokens,'
            'coalesce(sum(cost_charged),0) AS cost,'
            'extract(epoch FROM (clock_timestamp()-min(created_at))) AS elapsed '
            'FROM evaluation_judgments WHERE evaluation_job_id=%s',
            (evaluation_id,),
        ).fetchone()
        remaining = limits['wall_seconds'] - float(used['elapsed'] or 0)
        reason = None
        if remaining <= 0:
            reason = 'Judge time budget exhausted'
        elif int(used['tokens']) + bound > limits['tokens']:
            reason = 'Judge token budget exhausted'
        elif known and float(used['cost']) + cost > limits['estimated_cost_usd']:
            reason = 'Judge estimated cost budget exhausted'
        result = (
            {
                'status': 'ungraded',
                'reason': reason,
                'estimated_cost_usd': 0,
                'cost_source': 'no call',
            }
            if reason
            else {'status': 'reserved'}
        )
        row = conn.execute(
            'INSERT INTO evaluation_judgments(id,evaluation_job_id,project_id,'
            'run_id,claim_index,request,status,result,token_bound,tokens_charged,cost_charged) '
            'VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *',
            (
                db.uid(),
                evaluation_id,
                project_id,
                run_id,
                index,
                db.jsonb(request),
                'ungraded' if reason else 'reserved',
                db.jsonb(result),
                bound,
                0 if reason else bound,
                0 if reason else cost,
            ),
        ).fetchone()
    return row, not reason, remaining


def finish(row, result, usage, pinned):
    known = pinned['cost_estimates_available']
    tokens = usage['total_tokens'] if usage else row['tokens_charged']
    cost = float(row['cost_charged'])
    if usage and known:
        cost = (
            usage['input_tokens'] * pinned['input_usd_per_million']
            + usage['output_tokens'] * pinned['output_usd_per_million']
        ) / 1_000_000
    result.update(
        {
            'usage': usage,
            'estimated_cost_usd': cost if known else None,
            'cost_source': 'reported usage at pinned rates'
            if usage and known
            else 'reservation at pinned rates'
            if known
            else 'unavailable',
        }
    )
    db.execute(
        'UPDATE evaluation_judgments SET status=%s,result=%s,tokens_charged=%s,'
        "cost_charged=%s,updated_at=now() WHERE id=%s AND project_id=%s AND status='reserved'",
        (result['status'], db.jsonb(result), tokens, cost, row['id'], row['project_id']),
    )


def grade_run(evaluation_id, project_id, owner, run, pinned, check_active):
    check_active()
    judge_policy.validate_snapshot(pinned)
    if str(run['project_id']) != str(project_id) or str(run['evaluation_job_id']) != str(
        evaluation_id
    ):
        raise ValueError('Judge run is outside the evaluation scope')
    report = Report.model_validate(run['report']) if run['report'] else None
    claims = report.claims if report else []
    evidence = {str(e['id']): e for e in for_run(run)}
    sampled = claims[: pinned['configuration']['max_claims_per_run']]
    for index, claim in enumerate(sampled):
        check_active()
        content, bound, request = judge_policy.prepare_claim(claim, evidence)
        request.update(
            {
                'model_id': pinned['model_id'],
                'prompt_sha256': pinned['prompt_sha256'],
                'schema_sha256': pinned['schema_sha256'],
                'adapter': pinned['adapter'],
            }
        )
        if pinned.get('provider') == 'anthropic':
            request['provider'] = 'anthropic'
        row, invoke, remaining = reserve(
            evaluation_id, project_id, owner, run['id'], index, request, bound, pinned, check_active
        )
        if not invoke:
            continue
        try:
            check_active()
        except Exception:
            finish(
                row,
                {'status': 'ungraded', 'reason': 'Evaluation stopped before the judge call'},
                None,
                pinned,
            )
            raise
        s = settings()
        try:
            key = environment_credential(pinned, s)
        except ValueError:
            key = None
        if not s.live_enabled or not key or run['mode'] != 'live':
            finish(
                row,
                {
                    'status': 'ungraded',
                    'reason': 'Live judge credentials or execution are unavailable',
                },
                None,
                pinned,
            )
            continue
        usage = None
        try:
            output = judge_policy.SemanticJudge(pinned, key).invoke(
                content, max(0.1, min(30, remaining))
            )
            usage = judge_policy.usage_counts(output.get('raw'))
            if output.get('parsing_error') or output.get('parsed') is None:
                result = {
                    'status': 'ungraded',
                    'reason': 'Judge output did not match the semantic contract',
                }
            else:
                grade = SemanticJudgment.model_validate(output['parsed'])
                clean = SemanticJudgment.model_validate(redact(grade.model_dump()))
                result = {'status': 'graded', **clean.model_dump()}
        except Exception:
            result = {
                'status': 'ungraded',
                'reason': 'Judge call failed; reservation retained when usage is unavailable',
            }
        # Save the paid response before honoring cancellation/lease loss.
        finish(row, result, usage, pinned)
        check_active()
    rows = public_rows(evaluation_id, project_id, run['id'])
    graded = [row for row in rows if row['status'] == 'graded']
    return {
        'model_id': pinned['model_id'],
        'prompt_sha256': pinned['prompt_sha256'],
        'schema_sha256': pinned['schema_sha256'],
        'claims': len(claims),
        'sampled': len(sampled),
        'unsampled': len(claims) - len(sampled),
        'graded': len(graded),
        'ungraded': len(rows) - len(graded),
        'judgments': rows,
        'semantic_support': sum(row['result']['label'] == 'supported' for row in graded)
        / len(graded)
        if graded
        else None,
        'limitations': 'Fallible model judgment of sampled cited claims only; not independent ground truth',
    }
