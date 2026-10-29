"""Per-request ingestion accounting, independent of source commits and research budgets."""

import hashlib
import json
import re
from decimal import Decimal
from uuid import NAMESPACE_URL, uuid5

import psycopg

from . import db


class AccountingError(ValueError):
    pass


def pin_rate(value):
    return Decimal(str(value)) if value is not None else None


def reported_tokens(response):
    usage = (
        response.get('usage') if isinstance(response, dict) else getattr(response, 'usage', None)
    )
    value = (
        usage.get('total_tokens')
        if isinstance(usage, dict)
        else getattr(usage, 'total_tokens', None)
    )
    return value if type(value) is int and 0 <= value <= 2**63 - 1 else None


def request_id(response):
    value = getattr(response, '_request_id', None) or getattr(response, 'request_id', None)
    return (
        value
        if isinstance(value, str) and re.fullmatch(r'req_[A-Za-z0-9_-]{1,124}', value)
        else None
    )


class Recorder:
    def __init__(
        self,
        project_id,
        collection_id,
        source_version_id,
        *,
        rate=None,
        job_id=None,
        owner=None,
        before_call=None,
    ):
        self.project_id, self.collection_id, self.source_version_id = (
            project_id,
            collection_id,
            source_version_id,
        )
        self.job_id = job_id
        self.attempt = str(job_id) if job_id else db.uid()
        self.owner = owner or db.uid()
        self.rate = pin_rate(rate)
        self.before_call = before_call
        self.ordinal = 0

    def reserve(self, params):
        texts = params.get('input')
        if (
            params.get('model') != 'text-embedding-3-small'
            or params.get('dimensions') != 1536
            or not isinstance(texts, list)
            or not 1 <= len(texts) <= 32
            or any(not isinstance(text, str) or not text or len(text) > 1600 for text in texts)
        ):
            raise AccountingError(
                'Embedding request exceeds the fixed ingestion profile or passage limits.'
            )
        bound = sum(len(text.encode('utf-8')) for text in texts)
        digest = hashlib.sha256(
            json.dumps(
                {'model': params['model'], 'dimensions': 1536, 'input': texts},
                ensure_ascii=False,
                separators=(',', ':'),
            ).encode()
        ).hexdigest()
        rid = str(uuid5(NAMESPACE_URL, f'embedding/{self.attempt}/{self.ordinal}'))
        try:
            with db.connection() as conn:
                if self.before_call:
                    self.before_call(conn)
                inserted = conn.execute(
                    'INSERT INTO embedding_usage(id,project_id,collection_id,source_version_id,job_id,attempt_id,owner,ordinal,model,dimensions,input_hash,input_count,input_token_bound,usd_per_million) '
                    'VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,1536,%s,%s,%s,%s) ON CONFLICT(id) DO NOTHING RETURNING id',
                    (
                        rid,
                        self.project_id,
                        self.collection_id,
                        self.source_version_id,
                        self.job_id,
                        self.attempt,
                        self.owner,
                        self.ordinal,
                        params['model'],
                        digest,
                        len(texts),
                        bound,
                        self.rate,
                    ),
                ).fetchone()
                if not inserted:
                    raise AccountingError(
                        'This embedding request is already recorded. Retry file preparation explicitly instead of replaying it.'
                    )
        except psycopg.Error as exc:
            raise AccountingError(
                'Embedding accounting is unavailable. Preparation stopped before another provider request.'
            ) from exc
        self.ordinal += 1
        return rid

    def finish(self, rid, response=None):
        tokens = reported_tokens(response)
        try:
            count = db.execute(
                'UPDATE embedding_usage SET status=%s,reported_tokens=%s,provider_request_id=%s,finished_at=clock_timestamp() '
                "WHERE id=%s AND project_id=%s AND owner=%s AND status='reserved'",
                (
                    'reported' if tokens is not None else 'unreported',
                    tokens,
                    request_id(response),
                    rid,
                    self.project_id,
                    self.owner,
                ),
            )
            if not count:
                raise AccountingError(
                    'Embedding usage could not be reconciled. Preparation stopped; inspect its recorded requests before retrying.'
                )
        except psycopg.Error as exc:
            raise AccountingError(
                'Embedding usage could not be saved. Preparation stopped; the recorded request has unreported usage.'
            ) from exc


class RecordingClient:
    """Wrap the LangChain embedding transport, retaining usage before vector processing."""

    def __init__(self, client, recorder):
        self.client, self.recorder = client, recorder

    def create(self, **params):
        rid = self.recorder.reserve(params)
        try:
            response = self.client.create(**params)
        except Exception as exc:
            self.recorder.finish(rid, exc)
            raise
        # Late responses remain accountable even after cancellation/lease loss.
        self.recorder.finish(rid, response)
        return response


def collection_usage(project_id, collection_id):
    summary = db.one(
        "SELECT count(*) AS requests,count(*) FILTER(WHERE status<>'reported') AS unreported_requests,"
        'sum(reported_tokens)::bigint AS reported_tokens,sum(input_token_bound) AS input_token_bound,'
        "CASE WHEN count(*)>0 AND count(*) FILTER(WHERE status<>'reported' OR usd_per_million IS NULL)=0 "
        'THEN sum(reported_tokens*usd_per_million/1000000) ELSE NULL END AS estimated_cost_usd '
        'FROM embedding_usage WHERE project_id=%s AND collection_id=%s',
        (project_id, collection_id),
    )
    rows = db.all_rows(
        'SELECT id,job_id,source_version_id,ordinal,model,dimensions,input_hash,input_count,input_token_bound,status,reported_tokens,'
        'usd_per_million,provider_request_id,created_at,finished_at,'
        'reported_tokens*usd_per_million/1000000 AS estimated_cost_usd '
        'FROM embedding_usage WHERE project_id=%s AND collection_id=%s ORDER BY created_at DESC,id DESC LIMIT 20',
        (project_id, collection_id),
    )
    return {'summary': summary, 'requests': rows}
