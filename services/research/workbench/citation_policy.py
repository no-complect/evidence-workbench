"""Citation content checks after the repository has applied project and run scope."""
from .models import Report


def validate_claims(report: Report, evidence: list[dict]):
    allowed = {str(e['id']): e for e in evidence}
    for claim in report.claims:
        for eid in claim.evidence_ids:
            if str(eid) not in allowed:
                raise ValueError(
                    'Citation rejected: evidence is missing or outside this run/project')
        if claim.support == 'direct_quote' and not any(claim.text in allowed[str(eid)]['text']
                                                       for eid in claim.evidence_ids):
            raise ValueError('Citation rejected: direct quote does not occur in cited evidence')
        if any(allowed[str(eid)]['metadata'].get('untrusted_instructions')
               for eid in claim.evidence_ids):
            raise ValueError('Citation rejected: flagged adversarial source')
    return True
