# ADR 003: One LangGraph with bounded research branches

Status: implemented; verification scope is recorded in [BUILD_STATUS](../BUILD_STATUS.md).

The product needs follow-up research only when evidence assessment identifies a useful gap. LangGraph owns the typed state, routing, interrupts, checkpointing and branch joins. LangChain supplies integrations. No second orchestration framework is added.

The default is one sequential researcher. At most three concurrent tasks return evidence IDs through an order-independent reducer. A reviewer assesses coverage and contradictions; a writer sees selected evidence and a provenance-preserving summary. Database-enforced budgets and deterministic effects remain outside model control. Basic RAG and a fixed workflow share the adapters to permit measured comparison. Extra autonomy is justified only if those measurements support it.
