"""Exercise local Supabase identity/RLS/private storage without hosted credentials."""
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit
from uuid import uuid4

import httpx

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.runtime/supabase-verification'


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def free_ports(count):
    sockets = []
    try:
        for _ in range(count):
            sock = socket.socket()
            sock.bind(('127.0.0.1', 0))
            sockets.append(sock)
        return [sock.getsockname()[1] for sock in sockets]
    finally:
        for sock in sockets:
            sock.close()


def local_environment(source):
    # No root .env is read: Python services run from the isolated work directory.
    env = {key: value for key, value in source.items() if not key.startswith(
        ('SUPABASE_', 'NEXT_PUBLIC_', 'OPENAI_', 'ANTHROPIC_', 'TAVILY_', 'API_'))
           and key not in {'DATABASE_URL', 'CREDENTIAL_STORE_PATH', 'STORAGE_PATH'}}
    env.update(APP_ENV='test', AUTH_MODE='supabase', STORAGE_BACKEND='supabase',
               LIVE_ENABLED='false', OPENAI_API_KEY='', ANTHROPIC_API_KEY='', TAVILY_API_KEY='',
               NEXT_TELEMETRY_DISABLED='1', PYTHONPATH=str(ROOT / 'services/research'))
    return env


def local_status(data, api_port, db_port):
    for key, port in [('API_URL', api_port), ('DB_URL', db_port)]:
        url = urlsplit(data.get(key, ''))
        require(url.hostname == '127.0.0.1' and url.port == port,
                'Supabase status must point to the owned local project')
    require(data.get('ANON_KEY') and data.get('SERVICE_ROLE_KEY'),
            'Supabase did not return the local API credentials')
    return data


def main():
    require(shutil.which('docker') and shutil.which('supabase'),
            'Docker and Supabase CLI 2.120.0 are required')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    api_port, db_port, shadow_port, web_port, backend_port = free_ports(5)
    project = 'workbench-auth-' + uuid4().hex[:12]
    env = local_environment(os.environ)
    processes, logs = [], []

    def interrupted(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupted)
    with tempfile.TemporaryDirectory(prefix='workbench-supabase-') as directory:
        folder = Path(directory)
        (folder / 'supabase').mkdir()
        web_url = f'http://127.0.0.1:{web_port}'
        (folder / 'supabase/config.toml').write_text(f'''
project_id = "{project}"
[api]
enabled = true
port = {api_port}
schemas = ["public"]
extra_search_path = ["public", "extensions"]
[db]
port = {db_port}
shadow_port = {shadow_port}
major_version = 17
[db.seed]
enabled = false
[studio]
enabled = false
[analytics]
enabled = false
[realtime]
enabled = false
[edge_runtime]
enabled = false
[auth]
enabled = true
site_url = "{web_url}"
additional_redirect_urls = ["{web_url}"]
enable_signup = true
[auth.email]
enable_signup = true
enable_confirmations = false
[storage]
enabled = true
file_size_limit = "8MiB"
''')

        def cli(*args, timeout=600):
            # CLI startup/status may contain local credentials. Never stream or
            # attach raw output to artifacts, even when startup fails.
            result = subprocess.run(['supabase', '--workdir', str(folder), *args],
                                    env=env, cwd=folder, capture_output=True, text=True,
                                    timeout=timeout)
            require(result.returncode == 0, f'Supabase {args[0]} failed (exit {result.returncode})')
            return result.stdout

        def command(args, *, cwd=folder, timeout=180):
            subprocess.run(args, cwd=cwd, env=env, check=True, timeout=timeout)

        def start(name, args, cwd=folder):
            log = (OUTPUT / (name + '.log')).open('w')
            logs.append(log)
            processes.append(subprocess.Popen(args, cwd=cwd, env=env, stdout=log,
                                              stderr=subprocess.STDOUT, start_new_session=True))

        def ready(url):
            deadline = time.monotonic() + 90
            with httpx.Client(trust_env=False, timeout=2) as client:
                while time.monotonic() < deadline:
                    require(all(p.poll() is None for p in processes), 'An application process exited')
                    try:
                        if client.get(url).status_code == 200:
                            return
                    except httpx.HTTPError:
                        pass
                    time.sleep(.5)
            raise RuntimeError('Application readiness timed out')

        try:
            version = subprocess.check_output(['supabase', '--version'], text=True, env=env).strip()
            require(version == '2.120.0', 'Use the pinned Supabase CLI 2.120.0')
            print('Starting isolated Supabase Auth, PostgREST and private Storage…', flush=True)
            cli('start', '--exclude', 'studio,imgproxy,realtime,postgres-meta,edge-runtime,logflare,vector,supavisor,mailpit')
            status = local_status(json.loads(cli('status', '-o', 'json')), api_port, db_port)
            for key in ['ANON_KEY', 'SERVICE_ROLE_KEY', 'JWT_SECRET', 'DB_URL']:
                if status.get(key) and os.environ.get('GITHUB_ACTIONS') == 'true':
                    print('::add-mask::' + status[key], flush=True)
            env.update(DATABASE_URL=status['DB_URL'], SUPABASE_URL=status['API_URL'],
                       SUPABASE_ANON_KEY=status['ANON_KEY'],
                       SUPABASE_SERVICE_ROLE_KEY=status['SERVICE_ROLE_KEY'],
                       API_SHARED_SECRET=secrets.token_hex(32),
                       API_URL=f'http://127.0.0.1:{backend_port}',
                       NEXT_PUBLIC_AUTH_MODE='supabase',
                       NEXT_PUBLIC_SUPABASE_URL=status['API_URL'],
                       NEXT_PUBLIC_SUPABASE_ANON_KEY=status['ANON_KEY'],
                       WORKBENCH_WEB_URL=web_url, WORKBENCH_SUPABASE_TEST='1')
            command([sys.executable, '-c',
                     'from workbench.db import migrate, execute; migrate(); '
                     'execute("NOTIFY pgrst, \'reload schema\'")'])
            command(['npm', 'run', 'build'], cwd=ROOT / 'apps/web', timeout=300)
            start('api', [sys.executable, '-m', 'uvicorn', 'workbench.api:app',
                          '--host', '127.0.0.1', '--port', str(backend_port)])
            start('worker', [sys.executable, '-m', 'workbench.worker'])
            start('ingestion-worker', [sys.executable, '-m', 'workbench.ingestion_worker'])
            start('web', ['npm', 'run', 'start', '--', '--hostname', '127.0.0.1',
                          '--port', str(web_port)], cwd=ROOT / 'apps/web')
            ready(env['API_URL'] + '/health')
            ready(web_url)
            command(['npm', '--prefix', str(ROOT / 'apps/web'), 'run', 'test:e2e', '--',
                     '--config=playwright.supabase.config.ts'], cwd=ROOT, timeout=360)
            (OUTPUT / 'result.json').write_text(json.dumps({
                'supabase_cli': version, 'auth': 'real-local-gotrue', 'storage': 'real-local-private',
                'identities_per_browser': 2, 'provider_calls': False,
                'hosted_deployment_verified': False, 'project': project,
            }, indent=2) + '\n')
            print('PASS: real local Supabase identities, RLS, storage and browser isolation', flush=True)
        finally:
            for process in processes:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGTERM)
            for process in processes:
                try:
                    process.wait(timeout=45)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
            for log in logs:
                log.close()
            cli('stop', '--project-id', project, '--no-backup', timeout=120)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.SubprocessError, OSError, ValueError) as exc:
        # Raw provider/service responses and token-bearing URLs are not printed.
        detail = ': ' + str(exc) if isinstance(exc, RuntimeError) else ''
        raise SystemExit(f'Supabase verification stopped ({type(exc).__name__}){detail}') from None
