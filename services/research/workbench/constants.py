from pathlib import Path
from importlib.resources import files
import os

PACKAGE_ROOT = Path(__file__).resolve().parent


def asset_root():
    """Installed wheels own their assets; editable checkouts retain one source copy."""
    packaged = Path(str(files('workbench').joinpath('_assets')))
    checkout = PACKAGE_ROOT.parents[2]
    for candidate in (packaged, checkout):
        if all((candidate / path).is_file() for path in
               ('prompts/plan-v1.md', 'fixtures/manifest.json', 'db/migrations/001_application.sql')):
            return candidate
    raise RuntimeError('Workbench runtime assets are missing; reinstall the complete package.')


ROOT = asset_root()
# Generated output is writable application data, never an installed package resource.
RESULTS = Path(os.environ.get('WORKBENCH_RESULTS_PATH') or 'evals/results').resolve()
DEMO_USER = '00000000-0000-0000-0000-000000000001'
DEMO_PROJECT = '10000000-0000-0000-0000-000000000001'
DEMO_COLLECTION = '20000000-0000-0000-0000-000000000001'
