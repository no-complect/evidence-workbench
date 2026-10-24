"""Build and verify an isolated, disposable local stack without paid providers."""
import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import Request, build_opener, ProxyHandler
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
TERMINAL = {'completed', 'partial', 'failed', 'cancelled'}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


class BrowserAPI:
    """Same-origin HTTP through Next; no backend secret or direct DB access."""

    def __init__(self, origin):
        self.origin = origin
        self.opener = build_opener(ProxyHandler({}))

    def request(self, path, body=None, *, status=200, text=False):
        headers = {'Origin': self.origin}
        if body is not None:
            headers['Content-Type'] = 'application/json'
        request = Request(self.origin + '/api/backend/' + path,
                          data=None if body is None else json.dumps(body).encode(),
                          headers=headers)
        try:
            response = self.opener.open(request, timeout=55)
        except HTTPError as exc:
            response = exc
        with response:
            require(response.status == status,
                    f'{request.get_method()} {path}: expected {status}, got {response.status}')
            data = response.read()
        return data.decode() if text else json.loads(data)

    def wait(self, path, desired, *, research=False, timeout=180):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            data = self.request(path)
            state = data['run']['status'] if research else data['status']
            if state == desired:
                return data
            require(state not in TERMINAL, f'{path}: unexpected terminal status {state}')
            time.sleep(.5)
        raise RuntimeError(f'{path}: timed out waiting for {desired}')


def verify(api, recreate):
    bootstrap = api.request('bootstrap')
    require(bootstrap['auth_mode'] == 'demo' and not bootstrap['live_enabled'],
            'Verification requires fixture execution with demo authentication')
    pid = api.request('projects', {'name': 'Container verification'}, status=201)['id']
    base = f'projects/{pid}'
    catalog = api.request(base + '/harness/models')
    require(not catalog['configured'] and not catalog['models'],
            'Provider credentials must be absent from the verification stack')
    setup = {'name': 'Fresh starter', 'purpose': 'Verify the shipped container workflow',
             'source_kind': 'starter', 'embedding_config': 'demo-v1',
             'idempotency_key': str(uuid4())}
    collection = api.request(base + '/collection-setups', setup, status=201)
    cid = collection['id']
    require(collection['setup_status'] == 'ready' and collection['document_count'] == 10,
            'Starter collection was not fully ingested')
    require(api.request(base + '/collection-setups', setup, status=201)['id'] == cid,
            'Collection setup retry created another collection')
    sources_path = f'{base}/collections/{cid}/sources'
    sources = api.request(sources_path)
    require(len(sources) == 10 and all(s['vector_chunk_count'] > 0 for s in sources),
            'Starter vectors are missing')
    run_body = {'collection_id': cid, 'question': bootstrap['examples'][0],
                'mode': 'demo', 'approve_plan': True, 'idempotency_key': str(uuid4())}
    rid = api.request(base + '/runs', run_body, status=202)['id']
    run_path = f'{base}/runs/{rid}'
    planned = api.wait(run_path, 'awaiting_approval', research=True)
    require(planned['run']['plan']['tasks'], 'Worker did not persist a plan')
    print('PASS: fresh migrations, starter collection, vectors and worker planning', flush=True)

    # Replace all application containers while approval is pending. Named volumes
    # survive, so this also tests the real checkpoint/approval resume path.
    recreate()
    require(api.request(run_path)['run']['status'] == 'awaiting_approval',
            'Pending approval did not survive container recreation')
    require(api.request(sources_path) == sources, 'Source identities changed after recreation')
    api.request(run_path + '/approve', planned['run']['plan'], status=202)
    detail = api.wait(run_path, 'completed', research=True)
    require(detail['contexts'] and detail['evidence'] and detail['run']['report']['claims'],
            'Research did not persist context, evidence and cited claims')
    claim = detail['run']['report']['claims'][0]
    evidence = api.request(f"{base}/evidence/{claim['evidence_ids'][0]}")
    require(evidence['text'] and evidence['version_id'], 'Citation provenance is missing')
    source = api.request(f"{base}/versions/{evidence['version_id']}/download", text=True)
    require(source, 'Shared source storage download is empty')
    report = api.request(run_path + '/report.md', text=True)
    require('Immutable version' in report and str(evidence['version_id']) in report,
            'Report export lost citation version identities')
    unknown = f'projects/{uuid4()}'
    api.request(f'{unknown}/evidence/{evidence["id"]}', status=404)
    api.request(f'{unknown}/versions/{evidence["version_id"]}/download', status=404)
    print('PASS: container recreation, approval resume, report, citation and shared storage',
          flush=True)

    evaluation = {'idempotency_key': str(uuid4()), 'custom': {
        'collection_id': cid, 'mode': 'demo', 'cases': [{
            'question': bootstrap['examples'][1], 'query': 'security retention',
            'expected_sources': [s['name'] for s in sources if 'security' in s['name']],
        }]}}
    require(evaluation['custom']['cases'][0]['expected_sources'], 'No security fixture source')
    job = api.request(base + '/evaluation-jobs', evaluation, status=202)
    require(api.request(base + '/evaluation-jobs', evaluation, status=202)['id'] == job['id'],
            'Evaluation retry duplicated the job')
    job_path = f"{base}/evaluation-jobs/{job['id']}"
    completed = api.wait(job_path, 'completed', timeout=240)
    require(completed['progress']['completed'] == completed['progress']['total'] == 3,
            'Evaluation did not execute all three research strategies')
    results = api.request(base + '/evaluations')
    saved = next(row for row in results if row['id'] == completed['result_id'])
    require(len(saved['raw']) == 3 and all(row['status'] == 'completed' for row in saved['raw']),
            'Evaluation has incomplete child runs')
    for row in saved['raw']:
        child = api.request(f"{base}/runs/{row['run_id']}")
        require(child['run']['evaluation_job_id'] == job['id'] and child['contexts'],
                'Evaluation result is not linked to a persisted research run')
    print('PASS: independent evaluation worker, three child strategies and persisted results',
          flush=True)
    return {'project_id': pid, 'collection_id': cid, 'run_id': rid,
            'evaluation_job_id': job['id'], 'evaluation_result_id': saved['id']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', action='store_true',
                        help='Also run existing collection and research browser journeys')
    parser.add_argument('--output', type=Path, default=ROOT / '.runtime/compose-verification')
    args = parser.parse_args()
    require(shutil.which('docker'), 'Docker Engine and Compose v2 are required')
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    project = 'workbench-verify-' + uuid4().hex[:12]
    env = dict(os.environ)
    # --env-file prevents root .env loading. Explicit values override inherited
    # shell variables too; no local provider credentials enter these containers.
    env.update({key: '' for key in (
        'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'TAVILY_API_KEY', 'ANTHROPIC_MODEL',
        'MODEL_INPUT_USD_PER_MILLION', 'MODEL_OUTPUT_USD_PER_MILLION',
        'EMBEDDING_USD_PER_MILLION', 'WEB_SEARCH_USD_PER_CALL')})
    env.update(LIVE_ENABLED='false', OPENAI_MODEL='gpt-4.1-mini',
               API_SHARED_SECRET='local-container-verification-only',
               WORKBENCH_WEB_PORT='0', WORKBENCH_API_PORT='0', WORKBENCH_DB_PORT='0',
               COMPOSE_PROFILES='', COMPOSE_REMOVE_ORPHANS='false')

    def interrupted(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupted)
    with tempfile.TemporaryDirectory(prefix='workbench-compose-') as folder:
        empty_env = Path(folder) / 'empty.env'
        empty_env.touch()
        command = ['docker', 'compose', '--project-name', project, '--project-directory',
                   str(ROOT), '--env-file', str(empty_env), '-f', str(ROOT / 'compose.yaml')]

        def compose(*arguments, capture=False, check=True, timeout=300):
            return subprocess.run(command + list(arguments), cwd=ROOT, env=env, check=check,
                                  text=True, stdout=subprocess.PIPE if capture else None,
                                  stderr=subprocess.STDOUT if capture else None, timeout=timeout)

        def origin(service, port):
            address = compose('port', service, str(port), capture=True).stdout.strip()
            require(address.startswith('127.0.0.1:') and address.count(':') == 1,
                    f'{service} did not bind an isolated loopback port')
            return 'http://' + address

        try:
            compose('version')
            compose('build', timeout=900)
            compose('up', '-d', '--wait', '--wait-timeout', '240')
            web = origin('web', 3000)
            api = BrowserAPI(web)
            require(api.request('bootstrap')['projects'], 'Initial seed is missing')

            def recreate():
                compose('up', '-d', '--no-deps', '--force-recreate', '--wait',
                        '--wait-timeout', '120', 'api', 'worker', 'eval-worker', 'web')
                # Ephemeral host ports can change when containers are replaced.
                api.origin = origin('web', 3000)

            result = verify(api, recreate)
            if args.browser:
                browser_env = {**env, 'WORKBENCH_WEB_URL': api.origin}
                subprocess.run(['npm', '--prefix', 'apps/web', 'run', 'test:e2e', '--',
                                'e2e/collections.spec.ts', 'e2e/journey.spec.ts'],
                               cwd=ROOT, env=browser_env, check=True, timeout=600)
            result.update(browser=args.browser, provider_calls=False, compose_project=project)
            (output / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
            print('PASS: isolated container verification; hosted auth/storage remain separate',
                  flush=True)
        finally:
            # Logs contain only this synthetic, credential-free project. Always
            # clean this project's volumes; never invoke an unscoped compose down.
            try:
                for name, arguments in [('services.json', ('ps', '--all', '--format', 'json')),
                                        ('containers.log', ('logs', '--no-color', '--tail', '2000'))]:
                    result = compose(*arguments, capture=True, check=False, timeout=30)
                    (output / name).write_text(result.stdout)
            finally:
                compose('down', '--volumes', '--remove-orphans', timeout=120)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.SubprocessError, OSError) as exc:
        raise SystemExit(f'Container verification failed: {exc}') from None
