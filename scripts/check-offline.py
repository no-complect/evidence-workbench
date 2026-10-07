"""Dependency-free integrity checks. Not a substitute for the runtime/integration suite."""
import ast
import hashlib
import json
import math
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
files = list((ROOT / 'services').rglob('*.py')) + list((ROOT / 'scripts').glob('*.py')) + list(
    (ROOT / 'tests').glob('*.py'))
for path in files:
    ast.parse(path.read_text(), filename=str(path))
manifest = json.loads((ROOT / 'fixtures/manifest.json').read_text())
count = 0
for doc in manifest['documents']:
    text = (ROOT / 'fixtures/corpus' / doc['file']).read_text()
    for match in re.finditer(r'\S[^\n]*(?:\n(?!\n)[^\n]+)*', text):
        passage = match.group().strip()
        vector = manifest['embeddings'][hashlib.sha256(passage.encode()).hexdigest()]
        assert len(vector) == 16
        assert all(math.isfinite(v) for v in vector)
        assert abs(sum(v * v for v in vector) - 1) < 1e-6 or all(v == 0 for v in vector)
        assert text[match.start():match.start() + len(passage)] == passage
        count += 1
cases = json.loads((ROOT / 'evals/cases.json').read_text())['cases']
assert len(cases) >= 12 and len({c['id'] for c in cases}) == len(cases)
for case in cases:
    for source in case.get('relevant_sources', []):
        assert (ROOT / 'fixtures/corpus' / source).is_file()
for path in (ROOT / 'scripts').glob('*.sh'):
    subprocess.run(['bash', '-n', str(path)], check=True)
print(
    f'PASS: syntax for {len(files)} Python files; {len(manifest["documents"])} corpus documents; {count} passage/vector/offset checks; {len(cases)} unique cases; shell syntax.'
)
