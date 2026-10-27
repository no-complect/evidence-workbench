"""Build and exercise the wheel away from the checkout, without service calls."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from zipfile import ZipFile

from workbench.evaluate import fingerprint

ROOT = Path(__file__).resolve().parents[1]


def main():
    expected = fingerprint()
    with tempfile.TemporaryDirectory(prefix='workbench-wheel-') as folder:
        folder = Path(folder)
        subprocess.run(['uv', 'build', '--wheel', '--out-dir', str(folder), str(ROOT)], check=True)
        wheel = next(folder.glob('*.whl'))
        installed = folder / 'installed'
        with ZipFile(wheel) as archive:
            archive.extractall(installed)
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(('OPENAI_', 'ANTHROPIC_', 'TAVILY_', 'SUPABASE_',
                                      'API_', 'DATABASE_', 'WORKBENCH_', 'PYTHONPATH'))}
        code = '''
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import workbench
assert Path(workbench.__file__).is_relative_to(Path(sys.argv[1]))
from workbench.constants import ROOT, RESULTS
from workbench.context import assemble
from workbench.evaluate import fingerprint
from workbench.judge_policy import rubric
from workbench.judge_calibration import load_cases
from workbench.ingest import MANIFEST
from workbench.api import app
assert assemble('plan', 'Package smoke check', [])[0]['trusted_instructions']
assert rubric() and load_cases() and len(MANIFEST['documents']) == 10
assert len(list((ROOT / 'db/migrations').glob('*.sql'))) == 10
assert fingerprint() == sys.argv[2], 'Wheel and checkout implementation hashes differ'
assert not RESULTS.is_relative_to(Path(workbench.__file__).parent)
assert app.openapi()['paths']
print('PASS: wheel imports API, prompts, migrations, fixtures and evaluation cases; fingerprints match')
'''
        subprocess.run([sys.executable, '-c', code, str(installed), expected],
                       cwd=folder, env=env, check=True)


if __name__ == '__main__':
    main()
