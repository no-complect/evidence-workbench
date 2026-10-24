"""Safety boundaries for the disposable Docker verification runner, not Docker substitutes."""
import importlib.util
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
import sys
import threading

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('compose_verification', ROOT / 'scripts/verify-compose.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


@pytest.mark.parametrize('failure', ['build', 'journey'])
def test_owned_project_cleanup_and_no_inherited_credentials(tmp_path, monkeypatch, failure):
    calls = []
    monkeypatch.setattr(sys, 'argv', ['verify-compose.py', '--output', str(tmp_path)])
    monkeypatch.setattr(runner.shutil, 'which', lambda _: '/usr/bin/docker')
    monkeypatch.setattr(runner.signal, 'signal', lambda *args: None)
    for name in ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'TAVILY_API_KEY']:
        monkeypatch.setenv(name, 'synthetic-private-value')
    monkeypatch.setenv('LIVE_ENABLED', 'true')
    monkeypatch.setenv('COMPOSE_PROJECT_NAME', 'existing-user-stack')

    def command(args, **kwargs):
        calls.append((args, kwargs['env']))
        envfile = Path(args[args.index('--env-file') + 1])
        assert envfile.is_file() and envfile.read_bytes() == b''
        if 'build' in args and failure == 'build':
            raise subprocess.CalledProcessError(1, args)
        output = '127.0.0.1:43123\n' if 'port' in args else ''
        return subprocess.CompletedProcess(args, 0, output)

    monkeypatch.setattr(runner.subprocess, 'run', command)
    monkeypatch.setattr(runner.BrowserAPI, 'request', lambda *args, **kwargs: {'projects': ['seed']})

    def fail_journey(*args):
        raise RuntimeError('Synthetic journey failure')

    monkeypatch.setattr(runner, 'verify', fail_journey)
    with pytest.raises((subprocess.CalledProcessError, RuntimeError)):
        runner.main()
    projects = {args[args.index('--project-name') + 1] for args, _ in calls}
    assert len(projects) == 1 and next(iter(projects)).startswith('workbench-verify-')
    assert 'existing-user-stack' not in projects
    assert calls[-1][0][-3:] == ['down', '--volumes', '--remove-orphans']
    for args, env in calls:
        assert args[args.index('-f') + 1] == str(ROOT / 'compose.yaml')
        assert all(env[name] == '' for name in ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'TAVILY_API_KEY'])
        assert env['LIVE_ENABLED'] == 'false'
        assert all(env[name] == '0' for name in ['WORKBENCH_WEB_PORT', 'WORKBENCH_API_PORT', 'WORKBENCH_DB_PORT'])
    assert not (tmp_path / 'result.json').exists()


def test_wait_fails_immediately_on_terminal_job_error(monkeypatch):
    api = runner.BrowserAPI('http://127.0.0.1:43123')
    monkeypatch.setattr(api, 'request', lambda _: {'status': 'failed'})
    with pytest.raises(RuntimeError, match='unexpected terminal status failed'):
        api.wait('projects/synthetic/evaluation-jobs/synthetic', 'completed')


def test_browser_http_transport_and_safe_status_errors():
    seen = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            seen.append((self.command, self.path, self.headers['Origin']))
            self.send_response(404 if self.path.endswith('missing') else 200)
            self.end_headers()
            self.wfile.write(b'{"detail":"synthetic-private-body"}')

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            seen.append((self.command, self.path, self.headers['Origin'], body))
            self.send_response(201)
            self.end_headers()
            self.wfile.write(b'{"id":"synthetic"}')

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        origin = f'http://127.0.0.1:{server.server_port}'
        api = runner.BrowserAPI(origin)
        assert api.request('bootstrap')['detail'] == 'synthetic-private-body'
        assert api.request('projects', {'name': 'Synthetic'}, status=201)['id'] == 'synthetic'
        assert api.request('missing', status=404)['detail'] == 'synthetic-private-body'
        with pytest.raises(RuntimeError, match='GET missing: expected 200, got 404') as exc:
            api.request('missing')
        assert 'synthetic-private-body' not in str(exc.value)
        assert seen[:2] == [('GET', '/api/backend/bootstrap', origin),
                            ('POST', '/api/backend/projects', origin, {'name': 'Synthetic'})]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
