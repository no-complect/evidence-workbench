from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator

DEFAULT_QUESTION = 'Compare three approaches to deploying an enterprise AI assistant. Investigate security, operating costs, retrieval quality, and maintenance. Support recommendations with evidence and identify unresolved questions.'
EXAMPLES = [
    DEFAULT_QUESTION,
    'What security controls are required for the AI assistant?',
    'Compare the operating costs of the three proposals.',
    'What evidence is stale or contradictory?',
    'What is the measured latency at one million users?',
]
TOPICS = ['security', 'cost', 'retrieval', 'maintenance']


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Limits(StrictModel):
    iterations: int = Field(2, ge=1, le=5)
    tool_calls: int = Field(24, ge=1, le=100)
    tokens: int = Field(48000, ge=500, le=200000)
    wall_seconds: int = Field(120, ge=5, le=900)
    concurrency: int = Field(1, ge=1, le=3)
    estimated_cost_usd: float = Field(1.0, ge=0, le=25, allow_inf_nan=False)
    top_k: int = Field(5, ge=1, le=20)


class StageModels(StrictModel):
    plan: str | None = Field(None, min_length=1, max_length=1024)
    assess: str | None = Field(None, min_length=1, max_length=1024)
    report: str | None = Field(None, min_length=1, max_length=1024)


class HarnessConfiguration(StrictModel):
    system_instruction: str = Field('', max_length=2000)
    context_policy: Literal['balanced', 'strict'] = 'balanced'
    stage_models: StageModels = Field(default_factory=StageModels)


class RunCreate(StrictModel):
    collection_id: UUID
    question: str = Field(min_length=10, max_length=4000)
    mode: Literal['demo', 'live'] = 'demo'
    strategy: Literal['rag', 'workflow', 'agent'] = 'agent'
    approve_plan: bool = True
    web_enabled: bool = False
    limits: Limits = Field(default_factory=Limits)
    idempotency_key: str = Field(min_length=8, max_length=128)
    harness_config: HarnessConfiguration | None = None
    harness_revision_id: UUID | None = None
    model_id: str | None = Field(None, min_length=1, max_length=1024)


class EvaluationCaseInput(StrictModel):
    question: str = Field(min_length=10, max_length=4000)
    query: str = Field(min_length=3, max_length=1000)
    expected_sources: list[Annotated[str, Field(min_length=1, max_length=180)]] = Field(
        default_factory=list, max_length=20
    )
    expect_no_evidence: bool = False
    expected_disclosure: str = Field('', max_length=200)

    @model_validator(mode='after')
    def expectation(self):
        if not self.expected_sources and not self.expect_no_evidence:
            raise ValueError('Choose expected sources or explicitly expect no supporting evidence')
        if self.expected_sources and self.expect_no_evidence:
            raise ValueError('Choose sources or no supporting evidence, not both')
        return self


class SemanticJudgment(StrictModel):
    label: Literal['supported', 'contradicted', 'insufficient']
    reason: str = Field(min_length=1, max_length=600)


class JudgeConfiguration(StrictModel):
    model_id: str = Field(min_length=1, max_length=1024)
    max_claims_per_run: int = Field(2, ge=1, le=5)
    tokens: int = Field(24000, ge=1000, le=200000)
    wall_seconds: int = Field(120, ge=5, le=300)
    estimated_cost_usd: float = Field(1.0, ge=0, le=25, allow_inf_nan=False)


class CustomEvaluation(StrictModel):
    collection_id: UUID
    mode: Literal['demo', 'live'] = 'demo'
    model_id: str | None = Field(None, min_length=1, max_length=1024)
    harness_config: HarnessConfiguration | None = None
    limits: Limits = Field(default_factory=Limits)
    cases: list[EvaluationCaseInput] = Field(min_length=1, max_length=6)
    confirm_paid: bool = False
    judge: JudgeConfiguration | None = None


class EvaluationCreate(StrictModel):
    split: Literal['all', 'development', 'held-out'] = 'development'
    custom: CustomEvaluation | None = None
    idempotency_key: str = Field(min_length=8, max_length=128)


class Task(StrictModel):
    id: str = Field(pattern=r'^[a-z0-9_-]{1,40}$')
    topic: str = Field(min_length=1, max_length=100)
    question: str = Field(min_length=3, max_length=600)


class Plan(StrictModel):
    tasks: list[Task] = Field(min_length=1, max_length=8)
    rationale: str = Field(max_length=1000)


class Assessment(StrictModel):
    covered: list[str]
    gaps: list[str]
    contradictions: list[str]
    followups: list[Task] = Field(default_factory=list, max_length=3)


class Claim(StrictModel):
    text: str = Field(min_length=1, max_length=2000)
    evidence_ids: list[UUID] = Field(min_length=1, max_length=8)
    support: Literal['direct_quote', 'model_assessed']


class Report(StrictModel):
    title: str
    summary: str
    claims: list[Claim]
    limitations: list[str]
    recommendations: list[str] = Field(default_factory=list)
    partial: bool = False


class SynthesisClaim(Claim):
    support: Literal['model_assessed'] = Field(
        description='Model synthesis or paraphrase, not a verified direct quotation or independent judgment.',
        # Some provider schema converters omit const but support a single-value enum.
        json_schema_extra={'enum': ['model_assessed']},
    )


class SynthesisReport(Report):
    """Live writer output; stored reports also support verified fixture excerpts."""

    claims: list[SynthesisClaim]


class Named(StrictModel):
    name: str = Field(min_length=1, max_length=100)


class HarnessPresetSettings(StrictModel):
    configuration: HarnessConfiguration
    limits: Limits
    model_id: str | None = Field(None, min_length=1, max_length=1024)
    judge_model_id: str | None = Field(None, min_length=1, max_length=1024)


class HarnessPresetCreate(Named):
    name: str = Field(min_length=1, max_length=100, pattern=r'\S')
    settings: HarnessPresetSettings
    idempotency_key: UUID


class HarnessPreset(Named):
    id: UUID
    settings: HarnessPresetSettings
    settings_hash: str
    schema_version: int
    created_at: datetime


class CollectionCreate(Named):
    embedding_config: Literal['demo-v1', 'openai-small-v1'] = 'demo-v1'


class CollectionSetup(CollectionCreate):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    purpose: str = Field(min_length=3, max_length=1000)
    source_kind: Literal['starter', 'upload']
    idempotency_key: UUID


class SearchRequest(StrictModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    collection_id: UUID
    query: str = Field(min_length=1, max_length=1000)
    top_k: int = Field(5, ge=1, le=20)
    method: Literal['keyword', 'vector', 'hybrid'] = 'hybrid'


class RunSummary(BaseModel):
    id: UUID
    project_id: UUID
    collection_id: UUID
    question: str
    mode: str
    strategy: str
    status: str
    plan: Plan | None = None
    report: Report | None = None
    error: str | None = None
    tokens_used: int
    tools_used: int
    cost_used: float


class ConnectionCreate(Named):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    use_environment: bool = False
    api_key: SecretStr | None = Field(None, min_length=16, max_length=512)

    @model_validator(mode='after')
    def credential_source(self):
        if self.use_environment == bool(self.api_key):
            raise ValueError('Choose exactly one credential source')
        return self


class ModelVerification(StrictModel):
    model_id: str = Field(pattern=r'^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$')
    input_usd_per_million: float = Field(gt=0, le=1000, allow_inf_nan=False)
    output_usd_per_million: float = Field(gt=0, le=10000, allow_inf_nan=False)
    max_cost_usd: float = Field(0.05, gt=0, le=1, allow_inf_nan=False)
    idempotency_key: UUID


class HarnessTargets(StrictModel):
    plan: UUID
    assess: UUID
    report: UUID


class HarnessCreate(Named):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    targets: HarnessTargets
    limits: Limits = Field(default_factory=Limits)
    idempotency_key: UUID
