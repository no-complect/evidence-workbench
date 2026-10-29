"""Equivalent contract check: TS request/response DTOs equal the Pydantic JSON schema.
Use --write to generate the file; no backend/database needs to be running.
"""

import json
import sys
from pathlib import Path

from workbench import responses
from workbench.models import (
    Claim,
    CollectionSetup,
    CustomEvaluation,
    EvaluationCaseInput,
    EvaluationCreate,
    HarnessConfiguration,
    HarnessCreate,
    HarnessPreset,
    HarnessPresetCreate,
    HarnessPresetSettings,
    HarnessTargets,
    JudgeConfiguration,
    Limits,
    ModelVerification,
    Plan,
    Report,
    RunCreate,
    RunSummary,
    SearchRequest,
    SemanticJudgment,
    StageModels,
    Task,
)

ROOT = Path(__file__).resolve().parents[1]


def ts(prop):
    if 'const' in prop:
        return json.dumps(prop['const'])
    if '$ref' in prop:
        return prop['$ref'].split('/')[-1]
    if 'enum' in prop:
        return ' | '.join(json.dumps(x) for x in prop['enum'])
    if 'anyOf' in prop:
        return ' | '.join(ts(x) for x in prop['anyOf'])
    kind = prop.get('type')
    if kind == 'array':
        item = ts(prop['items'])
        return f'({item})[]' if ' | ' in item else f'{item}[]'
    if kind == 'object':
        values = prop.get('additionalProperties', {})
        return (
            f'Record<string, {ts(values)}>'
            if isinstance(values, dict)
            else 'Record<string, unknown>'
        )
    return {
        'string': 'string',
        'integer': 'number',
        'number': 'number',
        'boolean': 'boolean',
        'null': 'null',
        'object': 'Record<string, unknown>',
    }.get(kind, 'unknown')


def generate():
    lines = ['// Generated from Pydantic by scripts/check-contracts.py --write. Do not edit.']
    for model in [
        Limits,
        Task,
        Plan,
        Claim,
        Report,
        StageModels,
        HarnessConfiguration,
        EvaluationCaseInput,
        SemanticJudgment,
        JudgeConfiguration,
        CustomEvaluation,
        EvaluationCreate,
        RunCreate,
        CollectionSetup,
        SearchRequest,
        ModelVerification,
        HarnessTargets,
        HarnessCreate,
        HarnessPresetSettings,
        HarnessPresetCreate,
        HarnessPreset,
    ]:
        schema = model.model_json_schema()
        fields = '; '.join(f'{name}: {ts(prop)}' for name, prop in schema['properties'].items())
        # Request defaults are sent explicitly by the client.
        lines.append(f'export type {model.__name__} = {{ {fields} }};')
    response_models = [RunSummary] + [
        value
        for name, value in vars(responses).items()
        if not name.startswith('_')
        and isinstance(value, type)
        and issubclass(value, responses.ApiResponse)
    ]
    for model in response_models:
        schema = model.model_json_schema()
        required = schema.get('required', [])
        fields = '; '.join(
            f'{name}{"" if name in required else "?"}: {ts(prop)}'
            for name, prop in schema['properties'].items()
        )
        lines.append(f'export type {model.__name__} = {{ {fields} }};')
    return '\n'.join(lines) + '\n'


if __name__ == '__main__':
    path = ROOT / 'packages/contracts/models.ts'
    expected = generate()
    if '--write' in sys.argv:
        path.write_text(expected)
        print('Generated request/response TypeScript contracts')
    elif path.read_text() != expected:
        raise SystemExit('Contract drift. Run uv run python scripts/check-contracts.py --write')
    else:
        print('Pydantic ↔ TypeScript contracts match')
