"""Validate evaluation expectations and freeze their corpus/model boundary."""
from fastapi import HTTPException
from . import db, environment_models, judge_policy
from .models import EXAMPLES
from .environment_models import snapshot as model_snapshot


def evaluation_input(custom):
    if not custom:
        return None
    data = custom.model_dump(mode='json')
    if data.get('judge') is None:
        data.pop('judge', None)
    return data


def prepare_custom(custom, project_id, user, s, request):
    target_collection = db.uid()
    if custom:
        collection = db.one('SELECT * FROM collections WHERE id=%s AND project_id=%s', (custom.collection_id, project_id))
        if not collection or collection['setup_status'] != 'ready':
            raise HTTPException(409, 'Choose a ready collection in this project')
        if custom.mode == 'demo' and (s.app_env not in {'local', 'test'} or s.auth_mode != 'demo'
                or collection['embedding_config'] != 'demo-v1' or any(c.question not in EXAMPLES for c in custom.cases)):
            raise HTTPException(422, 'Scripted evaluations require fixture embeddings and seeded questions. Use live mode for arbitrary questions.')
        if custom.mode == 'live' and (not custom.confirm_paid or not s.live_enabled or not s.openai_api_key):
            raise HTTPException(409, 'Enable live execution and explicitly confirm paid evaluation calls')
        if custom.mode == 'live' and collection['embedding_config'] != 'openai-small-v1':
            raise HTTPException(422, 'Live evaluation needs a live embedding collection')
        if custom.judge and custom.mode != 'live':
            raise HTTPException(422, 'Semantic judging requires an explicitly authorized live evaluation')
        documents = db.all_rows('SELECT d.name,d.current_version_id AS id FROM source_documents d WHERE d.project_id=%s AND d.collection_id=%s AND d.current_version_id IS NOT NULL ORDER BY d.name', (project_id, custom.collection_id))
        names = {d['name'] for d in documents}
        if not documents or any(name not in names for case in custom.cases for name in case.expected_sources):
            raise HTTPException(422, 'Expected sources must exist in the selected collection snapshot')
        pinned = model_snapshot(project_id, user, custom.model_id, custom.limits, collection, custom.harness_config) if custom.mode == 'live' else None
        judge = None
        if custom.judge:
            try:
                judge = judge_policy.snapshot(custom.judge, environment_models.catalog(project_id, user)['models'], s)
            except ValueError as exc:
                raise HTTPException(409, str(exc)) from exc
        data = evaluation_input(custom)
        request.update({'input': data, 'custom': {**data,
            'version_ids': [str(d['id']) for d in documents], 'model_snapshot': pinned,
            'judge_snapshot': judge}})
        target_collection = custom.collection_id
    return target_collection
