"""Source uploads, retrieval and authorized evidence downloads."""

from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response

from . import db
from . import responses as r
from .auth import authorize, identity
from .ingest import MAX_BYTES, IngestionConflict, IngestionError, ingest
from .models import SearchRequest
from .retrieval import search
from .storage import storage

router = APIRouter(prefix='/api/projects/{project_id}', tags=['sources'])


@router.get(
    '/collections/{collection_id}/sources',
    response_model=list[r.Source],
    response_model_exclude_unset=True,
)
def sources(project_id: UUID, collection_id: UUID, user=Depends(identity)):
    authorize(project_id, user)
    if not db.one(
        'SELECT id FROM collections WHERE id=%s AND project_id=%s', (collection_id, project_id)
    ):
        raise HTTPException(404, 'Collection not found')
    return db.serial(
        db.all_rows(
            'SELECT d.*, (SELECT count(*) FROM source_versions v WHERE v.document_id=d.id) AS version_count,'
            '(SELECT count(*) FROM chunks c WHERE c.version_id=d.current_version_id) AS chunk_count,'
            '(SELECT count(*) FROM chunks c WHERE c.version_id=d.current_version_id AND c.embedding IS NOT NULL) AS vector_chunk_count '
            'FROM source_documents d WHERE d.project_id=%s AND d.collection_id=%s ORDER BY d.name',
            (project_id, collection_id),
        )
    )


@router.post(
    '/collections/{collection_id}/sources',
    status_code=201,
    response_model=r.UploadResult,
    response_model_exclude_unset=True,
)
def upload(
    project_id: UUID, collection_id: UUID, file: UploadFile = File(...), user=Depends(identity)
):
    authorize(project_id, user)
    collection = db.one(
        'SELECT read_only,setup_status FROM collections WHERE id=%s AND project_id=%s',
        (collection_id, project_id),
    )
    if not collection:
        raise HTTPException(404, 'Collection not found')
    if collection['read_only']:
        raise HTTPException(
            409, 'Benchmark snapshots are read-only; create a collection to upload sources'
        )
    if collection['setup_status'] != 'ready':
        raise HTTPException(409, 'Finish or retry collection preparation before uploading')
    data = file.file.read(MAX_BYTES + 1)
    try:
        return ingest(
            project_id,
            collection_id,
            file.filename or 'upload.txt',
            data,
            {'synthetic': False, 'uploaded': True},
        )
    except IngestionConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except IngestionError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post('/search', response_model=list[r.SearchHit], response_model_exclude_unset=True)
def search_corpus(project_id: UUID, body: SearchRequest, user=Depends(identity)):
    authorize(project_id, user)
    try:
        return db.serial(
            search(project_id, body.collection_id, body.query, body.top_k, method=body.method)
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get(
    '/evidence/{evidence_id}', response_model=r.EvidenceLookup, response_model_exclude_unset=True
)
def evidence_lookup(project_id: UUID, evidence_id: UUID, user=Depends(identity)):
    authorize(project_id, user)
    row = db.one(
        'SELECT e.*,c.text,c.page,c.section,c.start_offset,c.end_offset,c.version_id,c.metadata FROM evidence e JOIN chunks c ON c.id=e.chunk_id AND c.project_id=e.project_id WHERE e.id=%s AND e.project_id=%s',
        (evidence_id, project_id),
    )
    if not row:
        raise HTTPException(404, 'Evidence not found')
    return db.serial(row)


@router.get(
    '/versions/{version_id}/download',
    response_class=Response,
    responses={
        200: {
            'content': {
                'application/octet-stream': {'schema': {'type': 'string', 'format': 'binary'}}
            }
        }
    },
)
def download(project_id: UUID, version_id: UUID, user=Depends(identity)):
    authorize(project_id, user)
    row = db.one(
        'SELECT * FROM source_versions WHERE id=%s AND project_id=%s', (version_id, project_id)
    )
    if not row:
        raise HTTPException(404, 'Source version not found')
    return Response(
        storage().get(row['storage_key']),
        media_type=row['media_type'],
        headers={
            'Content-Disposition': 'attachment; filename="source"',
            'X-Content-Type-Options': 'nosniff',
        },
    )
