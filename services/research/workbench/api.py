"""FastAPI application assembly, lifecycle and shared HTTP error handling."""

from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from . import db
from . import responses as r
from .collection_api import router as collection_router
from .config import settings
from .evaluation_api import router as evaluation_router
from .harness_api import router as harness_router
from .ingestion_api import router as ingestion_router
from .project_api import router as project_router
from .run_api import router as run_router
from .source_api import router as source_router


@asynccontextmanager
async def lifespan(app):
    settings()  # Fail closed before accepting traffic.
    with (
        db.pooled_connections(),
        httpx.Client(
            timeout=10,
            follow_redirects=False,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        ) as client,
    ):
        # Lifespan state is copied into each request; user headers remain per-request.
        yield {'auth_client': client}


app = FastAPI(title='Evidence Workbench', version='0.1.0', lifespan=lifespan)
app.include_router(project_router)
app.include_router(collection_router)
app.include_router(source_router)
app.include_router(run_router)
app.include_router(evaluation_router)
app.include_router(harness_router)
app.include_router(ingestion_router)


@app.exception_handler(RequestValidationError)
async def safe_validation_error(request, exc):
    # Validation details must never echo submitted credentials or arbitrary bodies.
    return JSONResponse(
        status_code=422,
        content={
            'detail': [
                {key: error[key] for key in ('loc', 'msg', 'type')} for error in exc.errors()
            ]
        },
    )


@app.get('/health', response_model=r.HealthResponse, response_model_exclude_unset=True)
def health():
    try:
        db.one('SELECT 1')
    except Exception as exc:
        raise HTTPException(503, 'Database unavailable') from exc
    return {'status': 'ok', 'version': '0.1.0'}
