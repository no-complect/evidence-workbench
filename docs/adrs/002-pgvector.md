# ADR 002: pgvector and Postgres full-text retrieval

Status: implemented; verification scope is recorded in [BUILD_STATUS](../BUILD_STATUS.md).

Keeping vectors beside project membership, immutable sources and citations makes scoped retrieval and provenance inspectable in SQL. Partial HNSW indexes separate the supported embedding identities/dimensions. GIN full-text search complements cosine retrieval; reciprocal-rank fusion combines ranked lists without pretending their raw scores are comparable.

A dedicated vector database would add synchronization, authorization and operational contracts before this corpus needs the scale. We do not claim pgvector is universally fastest. Measure realistic data and authorization filters before revisiting that choice. The current reranker adapter is disabled, visibly.
