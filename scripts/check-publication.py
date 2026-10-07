"""Inspect the public file set without staging files or exposing secret values."""
import argparse
import re
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = {
    'README.md', 'LICENSE', '.gitignore', '.dockerignore', '.env.example',
    'compose.yaml', 'pyproject.toml', 'uv.lock', 'apps/web/package.json',
    'apps/web/package-lock.json', 'apps/web/Dockerfile', 'services/research/Dockerfile',
    'db/migrations/001_application.sql', 'db/migrations/002_supabase_rls.sql',
    'fixtures/manifest.json', 'evals/cases.json', 'packages/contracts/models.ts',
    '.github/workflows/ci.yml', 'scripts/dev.sh', 'scripts/stop.sh',
    'scripts/demo.sh', 'scripts/eval.sh', 'scripts/test.sh',
    'docs/DEVELOPMENT.md', 'docs/RELEASING.md', 'docs/BUILD_STATUS.md',
    'docs/examples/reviewer-notes.txt', 'docs/examples/fixture-comparison.md',
    'docs/examples/fixture-comparison.json',
    'docs/diagrams/architecture.png', 'docs/diagrams/architecture.svg',
    'docs/diagrams/architecture.mmd',
}
LOCAL_DIRS = {
    '.venv', '.cache', '.runtime', 'node_modules', '.next', '__pycache__',
    '.pytest_cache', '.ruff_cache',
    '.vscode', 'playwright-report', 'test-results',
}
PATTERNS = {
    'private key': re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'),
    'provider credential': re.compile(r'\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}\b'),
    'GitHub credential': re.compile(r'\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b'),
    'AWS access key': re.compile(r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b'),
    'machine-specific home path': re.compile(r'/(?:Users|home)/[A-Za-z0-9._-]+/'),
}


def git(args, git_dir=None):
    command = ['git', '-C', str(ROOT)]
    if git_dir:
        command += [f'--git-dir={git_dir}', f'--work-tree={ROOT}']
    return subprocess.check_output(command + args, stderr=subprocess.PIPE)


def candidates(git_dir=None):
    return sorted(set(git(
        ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], git_dir
    ).decode().split('\0')) - {''})


def forbidden(name):
    path = Path(name)
    return (
        any(part in LOCAL_DIRS or part.startswith(('.a', '.c')) for part in path.parts)
        or (path.name.startswith('.env') and path.name != '.env.example')
        or path.suffix in {'.pem', '.key', '.log', '.pyc', '.tsbuildinfo'}
        or path.name == '.DS_Store'
        or (len(path.parts) == 1 and path.name.endswith('_prompt.md'))
        or name.startswith('docs/verification/')
        or (name.startswith('evals/results/') and name != 'evals/results/.gitkeep')
    )


def inspect(files):
    errors = [f'{name}: required runtime/reviewer asset is missing or ignored'
              for name in sorted(REQUIRED - set(files))]
    total = 0
    for name in files:
        path = ROOT / name
        if forbidden(name):
            errors.append(f'{name}: local/private artifact would be published')
        if path.is_symlink():
            errors.append(f'{name}: review symlink before publishing')
            continue
        if not path.is_file():
            errors.append(f'{name}: listed file is missing')
            continue
        data = path.read_bytes()
        total += len(data)
        if len(data) > 5 * 1024 * 1024:
            errors.append(f'{name}: exceeds the 5 MiB review threshold')
        if name.startswith('scripts/') and name.endswith('.sh'):
            if not path.stat().st_mode & 0o111:
                errors.append(f'{name}: shell script is not executable')
        if b'\0' in data:
            continue
        content = data.decode('utf-8', errors='replace')
        for label, pattern in PATTERNS.items():
            if pattern.search(content):
                errors.append(f'{name}: possible {label} (value withheld)')
        if name == '.env.example':
            for line in content.splitlines():
                if '=' not in line or line.lstrip().startswith('#'):
                    continue
                key, value = line.split('=', 1)
                if any(word in key for word in ('KEY', 'SECRET', 'TOKEN', 'PASSWORD')):
                    value = value.strip().strip('"\'')
                    if value and not (key == 'API_SHARED_SECRET'
                                      and value == 'local-demo-only-not-for-production'):
                        errors.append(f'{name}: {key} must be empty or an explicit demo default')
        if path.suffix == '.md':
            for target in re.findall(r'\[[^\]\n]*\]\(([^)\n]+)\)', content):
                if re.match(r'^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|#)', target):
                    continue
                target_path = target.split('#', 1)[0]
                resolved = (path.parent / target_path).resolve()
                if not resolved.exists():
                    errors.append(f'{name}: broken local link to {target}')
                elif resolved.is_file():
                    try:
                        linked = resolved.relative_to(ROOT).as_posix()
                    except ValueError:
                        errors.append(f'{name}: local link leaves the repository')
                    else:
                        if linked not in files:
                            errors.append(f'{name}: links to an excluded file: {linked}')
    return errors, total


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--list', action='store_true', help='also list candidate paths')
    args = parser.parse_args()
    try:
        if (ROOT / '.git').exists():
            files = candidates()
        else:
            with tempfile.TemporaryDirectory(prefix='workbench-publication-') as folder:
                subprocess.run(['git', 'init', '--quiet', folder], check=True,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                files = candidates(Path(folder) / '.git')
        errors, total = inspect(files)
    except (OSError, subprocess.CalledProcessError):
        raise SystemExit('Publication check could not run; ensure Git is installed and files are readable.')
    if args.list:
        print('\n'.join(files))
    if errors:
        print('\n'.join(f'FAIL: {error}' for error in errors))
        raise SystemExit(1)
    print(f'PASS: {len(files)} candidate files ({total / 1024 / 1024:.2f} MiB); '
          'required assets, ignore boundaries, links, and common secret patterns checked.')
    print('Still review staged changes/history and run the clean-checkout demo before publishing.')


if __name__ == '__main__':
    main()
