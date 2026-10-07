"""Equivalent contract check: TS request/report DTOs equal the Pydantic JSON schema.
Use --write to generate the file; no backend/database needs to be running.
"""
import json
import sys
from pathlib import Path
from workbench.models import Limits, Task, Plan, Claim, Report, RunCreate

ROOT = Path(__file__).resolve().parents[1]


def ts(prop):
    if '$ref' in prop:
        return prop['$ref'].split('/')[-1]
    if 'enum' in prop:
        return ' | '.join(json.dumps(x) for x in prop['enum'])
    if 'anyOf' in prop:
        return ' | '.join(ts(x) for x in prop['anyOf'])
    kind = prop.get('type')
    if kind == 'array':
        return f'{ts(prop["items"])}[]'
    return {
        'string': 'string',
        'integer': 'number',
        'number': 'number',
        'boolean': 'boolean',
        'null': 'null',
        'object': 'Record<string, unknown>'
    }.get(kind, 'unknown')


def generate():
    lines = ['// Generated from Pydantic by scripts/check-contracts.py --write. Do not edit.']
    for model in [Limits, Task, Plan, Claim, Report, RunCreate]:
        schema = model.model_json_schema()
        fields = '; '.join(f'{name}: {ts(prop)}' for name, prop in schema['properties'].items())
        # Defaults are sent explicitly by the client; response fields are serialized in full.
        lines.append(f'export type {model.__name__} = {{ {fields} }};')
    return '\n'.join(lines) + '\n'


if __name__ == '__main__':
    path = ROOT / 'packages/contracts/models.ts'
    expected = generate()
    if '--write' in sys.argv:
        path.write_text(expected)
        print('Generated request/report TypeScript contracts')
    elif path.read_text() != expected:
        raise SystemExit('Contract drift. Run uv run python scripts/check-contracts.py --write')
    else:
        print('Pydantic ↔ TypeScript contracts match')
