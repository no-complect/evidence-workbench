"""Project discovery and workspace summaries."""

from uuid import UUID

from fastapi import APIRouter, Depends

from . import db
from . import responses as r
from .auth import authorize, identity
from .config import configuration_status, settings
from .models import EXAMPLES, Named

router = APIRouter(prefix='/api', tags=['projects'])


@router.get('/bootstrap', response_model=r.Bootstrap, response_model_exclude_unset=True)
def bootstrap(user=Depends(identity)):
    projects = db.all_rows(
        'SELECT p.* FROM projects p JOIN project_memberships m ON p.id=m.project_id WHERE m.user_id=%s ORDER BY p.created_at,p.id',
        (user,),
    )
    s = settings()
    return db.serial(
        {
            'projects': projects,
            'examples': EXAMPLES,
            'auth_mode': s.auth_mode,
            'live_enabled': bool(s.live_enabled and s.openai_api_key),
            'configuration': configuration_status(s),
            'model_catalog_enabled': True,
            'evaluations_enabled': s.app_env in {'local', 'test'} and s.auth_mode == 'demo',
            'mode_notice': 'Demo uses scripted responses and synthetic documents. Real retrieval, checkpoints and events.',
            'version': '0.1.0',
        }
    )


@router.post(
    '/projects', status_code=201, response_model=r.Project, response_model_exclude_unset=True
)
def create_project(body: Named, user=Depends(identity)):
    project_id = db.uid()
    with db.connection() as conn:
        conn.execute('INSERT INTO projects(id,name) VALUES(%s,%s)', (project_id, body.name))
        conn.execute("INSERT INTO project_memberships VALUES(%s,%s,'owner')", (project_id, user))
    return {'id': project_id, 'name': body.name}


@router.get(
    '/projects/{project_id}', response_model=r.ProjectData, response_model_exclude_unset=True
)
def project(project_id: UUID, user=Depends(identity)):
    authorize(project_id, user)
    return db.serial(
        {
            'collections': db.all_rows(
                'SELECT c.*,(SELECT count(*) FROM source_documents d WHERE d.collection_id=c.id) AS document_count FROM collections c WHERE c.project_id=%s ORDER BY c.created_at',
                (project_id,),
            ),
            'runs': db.all_rows(
                'SELECT id,question,status,mode,strategy,created_at FROM research_runs WHERE project_id=%s ORDER BY created_at DESC LIMIT 40',
                (project_id,),
            ),
        }
    )
