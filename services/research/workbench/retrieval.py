import json
from langchain_core.documents import Document
from langchain_core.retrievers import BaseRetriever
from . import db
from .ingest import MANIFEST
from .config import settings


class DisabledReranker:
    name = 'disabled'

    def rerank(self, query, items):
        return items


def query_vector(query, config):
    if config == 'demo-v1':
        # Supported topic aliases are fixtures, not arbitrary semantic inference.
        q = query.lower()
        topic = next(
            (t for t in
             ['retention', 'unknown', 'security', 'cost', 'retrieval', 'maintenance', 'comparison']
             if t in q), None)
        if 'compare three' in q or 'three approaches' in q:
            topic = 'comparison'
        if 'latency' in q or 'million' in q:
            topic = 'unknown'
        return MANIFEST['query_embeddings'].get(topic) if topic else None
    from langchain_openai import OpenAIEmbeddings
    s = settings()
    if not s.live_enabled or not s.openai_api_key:
        raise ValueError('Live embeddings unavailable')
    return OpenAIEmbeddings(model='text-embedding-3-small',
                            dimensions=1536,
                            api_key=s.openai_api_key,
                            max_retries=0,
                            request_timeout=30).embed_query(query)


def search(project_id, collection_id, query, top_k=5, version_ids=None):
    c = db.one('SELECT * FROM collections WHERE id=%s AND project_id=%s',
               (collection_id, project_id))
    if not c:
        raise ValueError('Collection not found in authorized project')
    config = c['embedding_config']
    vector = query_vector(query, config)
    # Retrieve latest immutable version per document; preserve old evidence for prior runs.
    scope = 'c.project_id=%s AND c.collection_id=%s AND c.embedding_config=%s AND c.version_id=d.current_version_id'
    base = 'SELECT c.*,d.name AS source_name,v.created_at AS ingested_at FROM chunks c JOIN source_versions v ON v.id=c.version_id JOIN source_documents d ON d.id=v.document_id WHERE '
    args = (project_id, collection_id, config)
    if version_ids is not None:
        scope = 'c.project_id=%s AND c.collection_id=%s AND c.embedding_config=%s AND c.version_id=ANY(%s::uuid[])'
        args = (*args, version_ids)
    fts = db.all_rows(
        base + scope +
        " AND c.search_vector @@ websearch_to_tsquery('english',%s) ORDER BY ts_rank_cd(c.search_vector,websearch_to_tsquery('english',%s)) DESC,c.id LIMIT %s",
        (*args, query, query, top_k * 4))
    semantic = []
    if vector:
        dim = 16 if config == 'demo-v1' else 1536
        semantic = db.all_rows(
            base + scope +
            f' AND c.embedding IS NOT NULL ORDER BY c.embedding::vector({dim}) <=> %s::vector({dim}),c.id LIMIT %s',
            (*args, json.dumps(vector), top_k * 4))
    scores = {}
    for label, rows in [('full_text', fts), ('vector', semantic)]:
        for rank, row in enumerate(rows, 1):
            cid = str(row['id'])
            entry = scores.setdefault(cid, {'chunk': row, 'rrf': 0., 'ranks': {}})
            entry['rrf'] += 1 / (60 + rank)
            entry['ranks'][label] = rank
    ordered = sorted(scores.values(), key=lambda e: (-e['rrf'], str(e['chunk']['id'])))[:top_k]
    for item in ordered:
        item['chunk'].pop('embedding', None)
        item['chunk'].pop('search_vector', None)
        item['reranker'] = 'disabled'
    return DisabledReranker().rerank(query, ordered)


class PostgresHybridRetriever(BaseRetriever):
    """Small LangChain integration; SQL owns scope and pgvector/FTS semantics."""
    project_id: str
    collection_id: str
    top_k: int = 5
    version_ids: list[str] | None = None

    def _get_relevant_documents(self, query, *, run_manager):
        return [
            Document(page_content=x['chunk']['text'], metadata=db.serial(x)) for x in search(
                self.project_id, self.collection_id, query, self.top_k, self.version_ids)
        ]
