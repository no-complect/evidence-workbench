"""Deployment checks must reject false positives without writes or credential output."""
import importlib.util
import json
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('deployment_verification',
                                              ROOT / 'scripts/verify-deployment.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
WEB, API = 'https://web.example', 'https://api.example'


def deployed(request):
    assert request.method == 'GET'
    assert 'x-workbench-key' not in request.headers
    if str(request.url) == WEB + '/':
        return httpx.Response(200, text='<title>Evidence Workbench</title>',
                              headers={'content-type': 'text/html'})
    if request.url.path == '/health':
        return httpx.Response(200, json={'status': 'ok', 'version': '0.1.0'})
    if request.url.host == 'api.example':
        return httpx.Response(401, json={'detail': 'Backend authentication required'})
    token = request.headers.get('authorization')
    if token == 'Bearer synthetic-user-session':
        return httpx.Response(200, json={'auth_mode': 'supabase', 'projects': []})
    return httpx.Response(401, json={
        'detail': 'Session expired or invalid' if token else 'Sign in to continue'})


@pytest.mark.parametrize('value', [
    'http://web.example', 'https://localhost', 'https://127.0.0.1', 'https://[::1]',
    'https://192.168.1.1', 'https://web.local', 'https://user:secret@web.example',
    'https://web.example/path', 'https://web.example?token=private',
    'https://web.example#private', 'https://web.example:bad', 'https://web.example\\other',
    'https://web.example\n', 'https://web..example', 'https://web.example:0',
])
def test_origins_reject_local_demo_or_credential_bearing_urls(value):
    with pytest.raises(runner.VerificationError):
        runner.origin(value)


def test_read_only_checks_use_only_explicit_session_on_web_proxy():
    requests = []

    def transport(request):
        requests.append(request)
        return deployed(request)

    with httpx.Client(transport=httpx.MockTransport(transport)) as client:
        result = runner.verify(client, WEB, API, 'synthetic-user-session')
    assert result['status'] == 'passed' and len(result['passed']) == 6
    assert len(requests) == 6
    assert all(request.headers.get('authorization') != 'Bearer synthetic-user-session'
               for request in requests if request.url.host != 'web.example')
    assert 'synthetic-user-session' not in json.dumps(result)
    assert runner.origin('https://WEB.example:443/') == WEB


@pytest.mark.parametrize('bad_response', [
    httpx.Response(302, headers={'location': 'https://other.example/token'}),
    httpx.Response(200, text='sign in to hosting platform', headers={'content-type': 'text/html'}),
    httpx.Response(503, json={'detail': 'synthetic-private-response'}),
])
def test_redirect_or_protection_page_never_passes(bad_response):
    with httpx.Client(transport=httpx.MockTransport(lambda _: bad_response)) as client:
        result = runner.verify(client, WEB, API, 'synthetic-user-session')
    assert result['status'] == 'failed' and not result['passed']
    assert 'synthetic-private' not in json.dumps(result)


@pytest.mark.parametrize('path,data', [
    ('/health', {'status': 'unavailable', 'version': '0.1.0'}),
    ('/api/backend/bootstrap', {'detail': 'Backend authentication required'}),
])
def test_database_failure_or_proxy_key_mismatch_does_not_pass(path, data):
    def transport(request):
        return httpx.Response(200 if path == '/health' else 401, json=data) \
            if request.url.path == path else deployed(request)

    with httpx.Client(transport=httpx.MockTransport(transport)) as client:
        assert runner.verify(client, WEB, API)['status'] == 'failed'


def test_bounded_response_and_transport_failures_do_not_expose_secrets(monkeypatch):
    monkeypatch.setattr(runner, 'MAX_RESPONSE_BYTES', 16)
    with httpx.Client(transport=httpx.MockTransport(deployed)) as client:
        assert runner.verify(client, WEB, API)['status'] == 'failed'

    def failed(request):
        raise httpx.ConnectError('synthetic-private-token', request=request)

    with httpx.Client(transport=httpx.MockTransport(failed)) as client:
        result = runner.verify(client, WEB, API, 'synthetic-user-session')
    assert result['status'] == 'failed'
    assert 'synthetic-private' not in json.dumps(result)


@pytest.mark.parametrize('body,content_type', [
    ('synthetic-private-invalid-json', 'application/json'),
    ('[]', 'application/json'),
    ('{"status":"ok"}', 'text/html'),
])
def test_invalid_api_payload_never_passes_or_reaches_output(body, content_type):
    def transport(request):
        if request.url.path == '/health':
            return httpx.Response(200, text=body, headers={'content-type': content_type})
        return deployed(request)

    with httpx.Client(transport=httpx.MockTransport(transport)) as client:
        result = runner.verify(client, WEB, API)
    assert result['status'] == 'failed'
    assert result['passed'] == ['web_html']
    assert 'synthetic-private' not in json.dumps(result)


def test_authenticated_route_cannot_silently_fall_back_to_demo_identity():
    def transport(request):
        if request.headers.get('authorization') == 'Bearer synthetic-user-session':
            return httpx.Response(200, json={'auth_mode': 'demo', 'projects': []})
        return deployed(request)

    with httpx.Client(transport=httpx.MockTransport(transport)) as client:
        result = runner.verify(client, WEB, API, 'synthetic-user-session')
    assert result['status'] == 'failed' and len(result['passed']) == 5


def test_cli_does_not_load_env_or_implicitly_use_session(monkeypatch, tmp_path, capsys):
    (tmp_path / '.env').write_text('WORKBENCH_ACCESS_TOKEN=synthetic-env-file-token\n')
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('WORKBENCH_ACCESS_TOKEN', 'synthetic-user-session')
    original_client = httpx.Client
    client_options = []

    def client(**options):
        client_options.append(options)
        return original_client(transport=httpx.MockTransport(deployed), **options)

    monkeypatch.setattr(runner.httpx, 'Client', client)
    output = tmp_path / 'result.json'
    args = ['--web-url', WEB, '--api-url', API, '--output', str(output)]
    assert runner.main(args) == 0
    report = json.loads(output.read_text())
    assert len(report['passed']) == 5 and report['authenticated_check'] == 'not_requested'
    assert not report['provider_calls'] and not report['writes_performed']
    assert 'research/evaluation worker execution' in report['not_verified']
    assert client_options == [{'timeout': 15, 'verify': True, 'trust_env': False,
                               'follow_redirects': False}]
    assert runner.main([*args, '--authenticated']) == 0
    assert len(json.loads(output.read_text())['passed']) == 6
    monkeypatch.delenv('WORKBENCH_ACCESS_TOKEN')
    assert runner.main([*args, '--authenticated']) == 1
    assert 'synthetic-user-session' not in capsys.readouterr().out
