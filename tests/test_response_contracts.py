"""Typed wire contracts preserve existing projections and legacy saved context."""

from workbench.api import app
from workbench.responses import Collection, Context


def test_every_success_response_has_an_openapi_schema():
    for path, operations in app.openapi()['paths'].items():
        for method, operation in operations.items():
            if method not in {'get', 'post'}:
                continue
            success = [
                value for code, value in operation['responses'].items() if code.startswith('2')
            ]
            assert success and all(
                any(body.get('schema') for body in response.get('content', {}).values())
                for response in success
            ), (method, path)


def test_response_validation_preserves_extra_projection_fields_without_adding_defaults():
    original = {
        'id': 'collection',
        'name': 'Existing collection',
        'document_count': 0,
        'embedding_config': 'demo-v1',
        'project_id': 'project',
    }
    assert (
        Collection.model_validate(original).model_dump(mode='json', exclude_unset=True) == original
    )


def test_legacy_context_payload_remains_readable_without_reconstructing_missing_metadata():
    original = {
        'id': 'saved',
        'stage': 'report',
        'call_key': 'historical-call',
        'payload': {'legacy_trace': 'retained verbatim'},
    }
    assert Context.model_validate(original).model_dump(mode='json', exclude_unset=True) == original
