from uuid import NAMESPACE_URL, uuid5
from . import db
from .models import Report
from .citation_policy import validate_claims


def for_run(run):
    return db.all_rows(
        'SELECT e.id,e.chunk_id,e.scores,c.text,c.page,c.section,c.start_offset,c.end_offset,c.metadata,c.version_id,d.name AS source_name FROM evidence e JOIN chunks c ON c.id=e.chunk_id AND c.project_id=e.project_id JOIN source_versions v ON v.id=c.version_id JOIN source_documents d ON d.id=v.document_id WHERE e.run_id=%s AND e.project_id=%s ORDER BY e.id',
        (run['id'], run['project_id']))


def verify(run, report: Report):
    return validate_claims(report, for_run(run))


def persist_report(run, report):
    verify(run, report)
    with db.connection() as conn:
        for i, claim in enumerate(report.claims):
            cid = str(uuid5(NAMESPACE_URL, f"{run['id']}/claim/{i}/{claim.text}"))
            conn.execute(
                'INSERT INTO claims(id,run_id,project_id,text,support) VALUES(%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING',
                (cid, run['id'], run['project_id'], claim.text, claim.support))
            for eid in claim.evidence_ids:
                conn.execute(
                    'INSERT INTO citations(claim_id,evidence_id,run_id,project_id) VALUES(%s,%s,%s,%s) ON CONFLICT DO NOTHING',
                    (cid, str(eid), run['id'], run['project_id']))
        conn.execute('UPDATE research_runs SET report=%s WHERE id=%s AND project_id=%s',
                     (db.jsonb(report.model_dump(mode='json')), run['id'], run['project_id']))


def markdown(run):
    report = Report.model_validate(run['report'])
    sources = {str(e['id']): e for e in for_run(run)}
    lines = [
        f'# {report.title}', f"\nMode: {run['mode']} · {run['status']}\n", report.summary,
        '\n## Findings\n'
    ]
    for claim in report.claims:
        cites = ' '.join(f'[^e-{e}]' for e in claim.evidence_ids)
        lines.append(f'- {claim.text} {cites}\n')
    lines += ['\n## Limitations\n'] + [f'- {limitation}' for limitation in report.limitations]
    lines += ['\n## Next steps\n'] + [f'- {r}' for r in report.recommendations]
    for eid in dict.fromkeys(str(e) for c in report.claims for e in c.evidence_ids):
        s = sources[eid]
        lines.append(
            f"\n[^e-{eid}]: {s['source_name']}, {s['section']}, page {s['page'] or 'n/a'}, offsets {s['start_offset']}–{s['end_offset']}. Immutable version {s['version_id']}; evidence {eid}."
        )
    return '\n'.join(lines) + '\n'
