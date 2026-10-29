"""Public API response contracts, shared with TypeScript through code generation.

Existing additional projection fields are retained for wire compatibility. Known
fields are validated; raw saved context and provenance metadata stay opaque.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from .models import Limits, Plan, Report


class ApiResponse(BaseModel):
    model_config = ConfigDict(extra='allow')


class CollectionIntent(ApiResponse):
    name: str
    embedding_config: str
    purpose: str
    source_kind: str


class RunListItem(ApiResponse):
    id: str
    question: str
    status: str
    mode: str
    strategy: str
    created_at: str


class Project(ApiResponse):
    id: str
    name: str


class Collection(ApiResponse):
    id: str
    name: str
    document_count: int
    embedding_config: str
    read_only: bool | None = None
    setup_status: Literal['preparing', 'ready', 'failed'] | None = None
    setup_error: str | None = None
    setup_request: CollectionIntent | None = None


class RunRequest(ApiResponse):
    limits: Limits


class Run(ApiResponse):
    id: str
    collection_id: str | None = None
    question: str
    status: str
    mode: str
    strategy: str
    plan: Plan | None
    report: Report | None
    error: str | None
    created_at: str
    tokens_used: int
    tools_used: int
    cost_used: str | float
    request: RunRequest
    harness_snapshot: HarnessSnapshot | None = None
    cancel_requested: bool


class EvidenceScores(ApiResponse):
    rrf: float | None = None
    ranks: dict[str, float] | None = None
    reranker: str


class EvidenceMetadata(ApiResponse):
    synthetic: bool | None = None
    stale: bool | None = None
    topics: list[str] | None = None
    reviewed_at: str | None = None
    untrusted_instructions: bool | None = None
    source_url: str | None = None


class Evidence(ApiResponse):
    id: str
    chunk_id: str
    text: str
    source_name: str
    version_id: str
    page: int | None
    section: str
    start_offset: int
    end_offset: int
    scores: EvidenceScores
    metadata: EvidenceMetadata


class RunEvent(ApiResponse):
    id: int
    stage: str
    message: str
    created_at: str
    data: dict[str, Any]


class ContextPayloadModelTarget(ApiResponse):
    provider: str | None = None
    model_id: str | None = None
    adapter: str | None = None


class ContextPayloadSelectedItem(ApiResponse):
    evidence_id: str
    reason: str


class ContextPayloadExcludedItem(ApiResponse):
    evidence_id: str
    reason: str


class ContextPayload(ApiResponse):
    model_target: ContextPayloadModelTarget | None = None
    policy_version: str | None = None
    prompt_id: str | None = None
    prompt_hash: str | None = None
    input_tokens_estimate: int | None = None
    token_estimator: str | None = None
    selected: list[ContextPayloadSelectedItem] | None = None
    excluded: list[ContextPayloadExcludedItem] | None = None
    assembled_input: Any | None = None
    output_token_reservation: int | None = None


class Context(ApiResponse):
    id: str
    stage: str
    call_key: str
    payload: ContextPayload


class DetailTasksItem(ApiResponse):
    id: str
    iteration: int
    question: str
    evidence_ids: list[str]


class Detail(ApiResponse):
    run: Run
    evidence: list[Evidence]
    contexts: list[Context]
    tasks: list[DetailTasksItem]


class Source(ApiResponse):
    id: str
    name: str
    status: str
    error: str | None
    chunk_count: int
    version_count: int
    vector_chunk_count: int | None = None
    current_version_id: str | None = None


class EvaluationResultsItem(ApiResponse):
    strategy: str
    cases: int
    recall_at_k: float | None
    mrr: float | None
    citation_validity: float
    quote_support: float | None
    completion_rate: float
    mean_tokens: float
    mean_latency_seconds: float
    estimated_cost_usd: float | None


class Evaluation(ApiResponse):
    id: str
    mode: str
    created_at: str
    versions: dict[str, Any]
    raw: list[EvaluationCase] | None = None
    results: list[EvaluationResultsItem]


class EvaluationCase(ApiResponse):
    case: str
    question: str | None = None
    expected_sources: list[str] | None = None
    expected_disclosure: str | None = None
    expect_no_evidence: bool | None = None
    split: str
    strategy: str
    run_id: str
    status: str
    checks: dict[str, bool]
    ranked_sources: list[str]
    latency_seconds: float
    recall_at_k: float | None = None
    mrr: float | None = None
    citation_validity: float | None = None
    quote_support: float | None = None
    tokens: float | None = None
    estimated_cost_usd: float | None = None
    judging: CaseJudging | None = None


class SemanticGradeRequest(ApiResponse):
    provider: str | None = None
    model_id: str
    claim_preview: str
    evidence_ids: list[str]
    source_version_ids: list[str]
    input_sha256: str
    prompt_sha256: str
    schema_sha256: str
    context_policy: str


class SemanticGradeResultUsage(ApiResponse):
    input_tokens: int
    output_tokens: int
    total_tokens: int


class SemanticGradeResult(ApiResponse):
    label: Literal['supported', 'contradicted', 'insufficient'] | None = None
    reason: str | None = None
    estimated_cost_usd: float | None = None
    cost_source: str | None = None
    usage: SemanticGradeResultUsage | None = None


class SemanticGrade(ApiResponse):
    id: str
    run_id: str
    claim_index: int
    status: Literal['reserved', 'graded', 'ungraded']
    request: SemanticGradeRequest
    result: SemanticGradeResult
    tokens_charged: int
    token_bound: int


class CaseJudging(ApiResponse):
    model_id: str
    claims: int
    sampled: int
    unsampled: int
    graded: int
    ungraded: int
    semantic_support: float | None
    judgments: list[SemanticGrade]


class EvaluationJobRequest(ApiResponse):
    split: str
    custom: dict[str, Any] | None = None


class EvaluationJobProgress(ApiResponse):
    completed: int | None = None
    total: int | None = None
    strategy: str | None = None
    case: str | None = None
    stage: str | None = None
    judged_runs: int | None = None


class EvaluationJob(ApiResponse):
    id: str
    status: Literal['queued', 'running', 'completed', 'failed', 'cancelled']
    request: EvaluationJobRequest
    progress: EvaluationJobProgress
    result_id: str | None
    cancel_requested: bool
    error: str | None
    created_at: str


class BootstrapConfiguration(ApiResponse):
    web_search_enabled: bool
    notices: list[str]


class Bootstrap(ApiResponse):
    configuration: BootstrapConfiguration | None = None
    projects: list[Project]
    examples: list[str]
    live_enabled: bool
    evaluations_enabled: bool
    model_catalog_enabled: bool | None = None
    auth_mode: Literal['demo', 'supabase']


class ProjectData(ApiResponse):
    collections: list[Collection]
    runs: list[RunListItem]


class CollectionOptionsDocumentsItem(ApiResponse):
    name: str
    bytes: int


class CollectionOptions(ApiResponse):
    documents: list[CollectionOptionsDocumentsItem]
    live_embeddings: bool


class UploadResult(ApiResponse):
    document_id: str
    version_id: str
    status: Literal['ready']
    deduplicated: bool
    chunks: int | None = None
    vector_chunks: int | None = None


class IngestionJob(ApiResponse):
    id: str
    collection_id: str
    name: str
    status: Literal['queued', 'running', 'ready', 'failed', 'cancelled']
    phase: Literal['queued', 'reading', 'embedding', 'storage', 'indexing', 'finished']
    error: str | None
    result: UploadResult | None
    retry_of: str | None
    created_at: str
    updated_at: str


class EmbeddingUsageSummary(ApiResponse):
    requests: int
    unreported_requests: int
    reported_tokens: int | None
    input_token_bound: int | None
    estimated_cost_usd: str | None


class EmbeddingUsageRequestsItem(ApiResponse):
    id: str
    job_id: str | None
    source_version_id: str
    ordinal: int
    model: str
    dimensions: int
    input_hash: str
    input_count: int
    input_token_bound: int
    status: Literal['reserved', 'reported', 'unreported']
    reported_tokens: int | None
    usd_per_million: str | None
    estimated_cost_usd: str | None
    provider_request_id: str | None
    created_at: str
    finished_at: str | None


class EmbeddingUsage(ApiResponse):
    summary: EmbeddingUsageSummary
    requests: list[EmbeddingUsageRequestsItem]


class SearchHitRanks(ApiResponse):
    full_text: float | None = None
    vector: float | None = None


class SearchHitChunk(ApiResponse):
    id: str
    text: str
    source_name: str
    version_id: str
    content_hash: str
    section: str
    page: int | None
    start_offset: int
    end_offset: int
    embedding_config: str
    metadata: EvidenceMetadata


class SearchHit(ApiResponse):
    rrf: float
    ranks: SearchHitRanks
    reranker: str
    chunk: SearchHitChunk


class ModelCatalogProvidersItem(ApiResponse):
    provider: Literal['openai', 'anthropic']
    count: int
    error: str | None


class ModelCatalog(ApiResponse):
    configured: bool
    models: list[str]
    default_model: str
    live_enabled: bool
    pricing_configured: bool
    judge_pricing_configured: bool | None = None
    returned_count: int | None = None
    request_id: str | None = None
    providers: list[ModelCatalogProvidersItem] | None = None
    embeddings_configured: bool | None = None


class ModelTarget(ApiResponse):
    model_id: str
    provider: str
    connection_id: str | None = None
    connection_name: str | None = None
    verification_id: str | None = None
    adapter: str | None = None
    input_usd_per_million: float | None
    output_usd_per_million: float | None


class HarnessSnapshotFingerprints(ApiResponse):
    adapter: str
    context_policy: str
    output_token_cap: float
    prompts: dict[str, str]
    contracts: dict[str, str]
    tool_policy: str


class HarnessSnapshot(ApiResponse):
    credential_source: Literal['environment'] | None = None
    cost_estimates_available: bool | None = None
    name: str | None = None
    revision_id: str | None = None
    targets: dict[str, ModelTarget]
    limits: Limits
    fingerprints: HarnessSnapshotFingerprints


class HarnessStudioState(ApiResponse):
    schemas: dict[str, dict[str, Any]]
    prompts: dict[str, str]
    context_caps: dict[str, float]
    context_policy: str


class EvidenceLookup(Evidence):
    # The lookup projection predates source_name; run-detail evidence includes it.
    source_name: str | None = None


class StatusResponse(ApiResponse):
    status: str


class HealthResponse(StatusResponse):
    version: str


class CreatedCollection(ApiResponse):
    id: str
    name: str
    embedding_config: str


class EventPage(ApiResponse):
    events: list[RunEvent]
    cursor: int


class ContractError(ApiResponse):
    path: str
    type: str


class ContractValidationResult(ApiResponse):
    valid: bool
    errors: list[ContractError]


class ProviderConnection(ApiResponse):
    id: str
    name: str
    provider: str
    active: bool
    catalog: list[str]


class ProviderCheck(ApiResponse):
    id: str
    status: str
    request: dict[str, Any]
    error: str | None


class HarnessRevision(ApiResponse):
    id: str
    name: str
    snapshot: HarnessSnapshot


class HarnessState(ApiResponse):
    server_key_available: bool
    live_enabled: bool
    connections: list[ProviderConnection]
    checks: list[ProviderCheck]
    revisions: list[HarnessRevision]


# Resolve nested DTOs whose declaration order follows their consuming UI types.
for _value in list(globals().values()):
    if isinstance(_value, type) and issubclass(_value, ApiResponse):
        _value.model_rebuild()
