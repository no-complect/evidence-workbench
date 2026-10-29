"""Author-annotated judge challenges and offline, coverage-aware scoring."""

import json
from typing import Literal
from uuid import NAMESPACE_URL, uuid5

from pydantic import Field, model_validator

from .constants import ROOT
from .judge_policy import digest, prepare_claim
from .models import Claim, SemanticJudgment, StrictModel

LABELS = ('supported', 'contradicted', 'insufficient')
CASES = ROOT / 'evals/judge-cases.json'


class Challenge(StrictModel):
    id: str = Field(pattern=r'^[a-z0-9-]{1,80}$')
    category: str = Field(min_length=1, max_length=80)
    claim: str = Field(min_length=1, max_length=2000)
    passages: list[str] = Field(min_length=1, max_length=8)
    expected: Literal['supported', 'contradicted', 'insufficient']
    annotation: str = Field(min_length=1, max_length=1000)

    @model_validator(mode='after')
    def bounded_passages(self):
        if any(not p.strip() or len(p) > 4000 for p in self.passages):
            raise ValueError('Challenge passages must contain 1–4000 characters')
        return self


class ChallengeSet(StrictModel):
    version: str = Field(min_length=1, max_length=80)
    description: str
    cases: list[Challenge] = Field(min_length=1, max_length=100)

    @model_validator(mode='after')
    def unique_ids(self):
        if len({case.id for case in self.cases}) != len(self.cases):
            raise ValueError('Duplicate challenge IDs')
        return self


class Prediction(StrictModel):
    case_id: str
    status: Literal['graded', 'ungraded', 'reserved']
    judgment: SemanticJudgment | None = None
    reason: str = Field('', max_length=600)

    @model_validator(mode='after')
    def coherent_grade(self):
        if (self.status == 'graded') != (self.judgment is not None):
            raise ValueError('Only graded predictions have judgments')
        return self


def load_cases(path=CASES):
    return ChallengeSet.model_validate(json.loads(path.read_text()))


def prepare(case):
    """Use the production cited-passages boundary; reference labels never enter it."""
    evidence = {}
    for index, passage in enumerate(case.passages):
        eid = str(uuid5(NAMESPACE_URL, f'judge-calibration/{case.id}/{index}'))
        evidence[eid] = {
            'text': passage,
            'metadata': {},
            'version_id': str(uuid5(NAMESPACE_URL, digest(passage))),
        }
    claim = Claim(text=case.claim, evidence_ids=list(evidence), support='model_assessed')
    return prepare_claim(claim, evidence)


def score(cases, predictions):
    """Never treat missing, failed or ungraded predictions as correct answers."""
    expected = {case.id: case for case in cases}
    parsed = [Prediction.model_validate(p) for p in predictions]
    if len({p.case_id for p in parsed}) != len(parsed):
        raise ValueError('Duplicate predictions')
    if any(p.case_id not in expected for p in parsed):
        raise ValueError('Prediction references an unknown challenge')
    by_id = {p.case_id: p for p in parsed}
    matrix = {label: {predicted: 0 for predicted in LABELS} for label in LABELS}
    rows = []
    for case in cases:
        prediction = by_id.get(case.id)
        label = prediction.judgment.label if prediction and prediction.judgment else None
        if label is not None:
            matrix[case.expected][label] += 1
        rows.append(
            {
                'case_id': case.id,
                'category': case.category,
                'expected': case.expected,
                'predicted': label,
                'status': prediction.status if prediction else 'missing',
                'correct': label == case.expected if label is not None else None,
            }
        )
    graded = sum(sum(row.values()) for row in matrix.values())
    non_support = sum(sum(matrix[label].values()) for label in LABELS if label != 'supported')
    false_support = sum(matrix[label]['supported'] for label in LABELS if label != 'supported')
    recall = {
        label: matrix[label][label] / sum(matrix[label].values())
        if sum(matrix[label].values())
        else None
        for label in LABELS
    }
    return {
        'total': len(cases),
        'graded': graded,
        'coverage': graded / len(cases) if cases else None,
        'accuracy_on_graded': sum(matrix[label][label] for label in LABELS) / graded
        if graded
        else None,
        'false_support_rate': false_support / non_support if non_support else None,
        'non_supported_graded': non_support,
        'false_support_count': false_support,
        'recall_on_graded': recall,
        'confusion_matrix': matrix,
        'cases': rows,
        'limitations': 'Small author-annotated synthetic development set, not held-out ground truth. '
        'Rates cover graded cases only; inspect coverage, denominators and individual failures. '
        'Scores measure judge agreement, not research quality or rationale correctness.',
    }
