from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field

DEFAULT_QUESTION = 'Compare three approaches to deploying an enterprise AI assistant. Investigate security, operating costs, retrieval quality, and maintenance. Support recommendations with evidence and identify unresolved questions.'
EXAMPLES = [
    DEFAULT_QUESTION, 'What security controls are required for the AI assistant?',
    'Compare the operating costs of the three proposals.',
    'What evidence is stale or contradictory?', 'What is the measured latency at one million users?'
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
    estimated_cost_usd: float = Field(1.0, ge=0, le=25)
    top_k: int = Field(5, ge=1, le=20)


class RunCreate(StrictModel):
    collection_id: UUID
    question: str = Field(min_length=10, max_length=4000)
    mode: Literal['demo', 'live'] = 'demo'
    strategy: Literal['rag', 'workflow', 'agent'] = 'agent'
    approve_plan: bool = True
    web_enabled: bool = False
    limits: Limits = Field(default_factory=Limits)
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


class Named(StrictModel):
    name: str = Field(min_length=1, max_length=100)


class CollectionCreate(Named):
    embedding_config: Literal['demo-v1', 'openai-small-v1'] = 'demo-v1'


class SearchRequest(StrictModel):
    collection_id: UUID
    query: str = Field(min_length=1, max_length=1000)
    top_k: int = Field(5, ge=1, le=20)


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
