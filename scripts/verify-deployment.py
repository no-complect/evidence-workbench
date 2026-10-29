"""Read-only local Docker or hosted web/API checks; no inference or writes."""

import argparse
import ipaddress
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

import httpx

ROOT = Path(__file__).resolve().parents[1]
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
LOCAL_HOSTS = {'localhost', '127.0.0.1', '::1'}
LOCAL_WEB = 'http://localhost:3000'
LOCAL_API = 'http://localhost:8000'


class VerificationError(RuntimeError):
    """Only fixed, credential-free messages may cross the CLI boundary."""


def require(condition, message):
    if not condition:
        raise VerificationError(message)


def origin(value, *, local=False):
    """Validate a loopback or public origin without credentials or token-bearing paths."""
    try:
        parsed = urlsplit(value)
        host = parsed.hostname or ''
        port = parsed.port
        require(
            parsed.scheme in ({'http', 'https'} if local else {'https'})
            and host
            and (port is None or port > 0)
            and parsed.username is None
            and parsed.password is None
            and parsed.path in {'', '/'}
            and not parsed.query
            and not parsed.fragment
            and not any(char.isspace() or char == '\\' for char in value),
            'Use an origin without credentials, path, query or fragment; hosted URLs require HTTPS',
        )
        if local:
            require(host in LOCAL_HOSTS, 'Local verification requires loopback origins')
        else:
            require(
                host != 'localhost' and not host.endswith(('.localhost', '.local')),
                'Deployment verification requires a public HTTPS origin',
            )
            try:
                address = ipaddress.ip_address(host)
            except ValueError:
                require(
                    '.' in host
                    and all(
                        part
                        and all(char.isascii() and (char.isalnum() or char == '-') for char in part)
                        for part in host.split('.')
                    ),
                    'Deployment hostname is invalid',
                )
            else:
                require(address.is_global, 'Deployment verification requires a public HTTPS origin')
        authority = f'[{host}]' if ':' in host else host
        default_port = 443 if parsed.scheme == 'https' else 80
        return (
            parsed.scheme
            + '://'
            + authority
            + (f':{port}' if port and port != default_port else '')
        )
    except ValueError:
        raise VerificationError('Deployment origin is invalid') from None


def targets(web_url='', api_url=''):
    """Empty inputs select Docker host ports without changing stored configuration."""
    web = web_url if web_url and web_url.strip() else LOCAL_WEB
    api = api_url if api_url and api_url.strip() else LOCAL_API
    try:
        local = [urlsplit(value).hostname in LOCAL_HOSTS for value in (web, api)]
    except ValueError:
        raise VerificationError('Deployment origin is invalid') from None
    require(
        local[0] == local[1], 'Use two hosted HTTPS origins, or leave URLs blank for local Docker'
    )
    return origin(web, local=local[0]), origin(api, local=local[1]), local[0]


def get(client, url, *, status=200, token=None, html=False):
    # Fixed paths, GET only, no shared backend/service-role/provider credentials.
    headers = {'Authorization': f'Bearer {token}'} if token else {}
    try:
        with client.stream('GET', url, headers=headers, follow_redirects=False) as response:
            require(
                response.status_code == status,
                'Unexpected HTTP status; check routing, protection and service configuration',
            )
            chunks, size = [], 0
            for part in response.iter_bytes():
                size += len(part)
                require(size <= MAX_RESPONSE_BYTES, 'Deployment response exceeded the read limit')
                chunks.append(part)
            body = b''.join(chunks)
            if html:
                require(
                    'text/html' in response.headers.get('content-type', ''),
                    'Web origin did not return HTML',
                )
                require(
                    b'<title>Evidence Workbench</title>' in body,
                    'Web origin did not return the Evidence Workbench page',
                )
                return None
            require(
                'application/json' in response.headers.get('content-type', ''),
                'API route did not return JSON',
            )
            try:
                data = json.loads(body)
            except (ValueError, UnicodeError):
                raise VerificationError('API route returned invalid JSON') from None
            require(isinstance(data, dict), 'API route returned an unexpected JSON shape')
            return data
    except httpx.HTTPError:
        # HTTP exceptions can include URLs and Authorization headers. Never print them.
        raise VerificationError(
            'HTTP request failed; check address, certificates and connectivity'
        ) from None


def verify(client, web, api, token=None, *, local=False):
    checks = []

    def check(name, action):
        action()
        checks.append(name)

    try:
        require(not local or not token, 'Authenticated checks require hosted HTTPS origins')
        check('web_html', lambda: get(client, web + '/', html=True))

        def health():
            data = get(client, api + '/health')
            require(
                data.get('status') == 'ok' and isinstance(data.get('version'), str),
                'API/database readiness did not pass',
            )

        check('api_database_readiness', health)

        def denied(url, detail, bearer=None):
            data = get(client, url, status=401, token=bearer)
            require(
                data.get('detail') == detail,
                'Authentication boundary returned an unexpected response',
            )

        check(
            'direct_api_requires_backend_key',
            lambda: denied(api + '/api/bootstrap', 'Backend authentication required'),
        )
        if local:

            def demo():
                data = get(client, web + '/api/backend/bootstrap')
                require(
                    data.get('auth_mode') == 'demo' and isinstance(data.get('projects'), list),
                    'Local Docker bootstrap did not confirm demo identity routing',
                )

            check('local_web_proxy_uses_demo_identity', demo)
            return {'status': 'passed', 'passed': checks}
        # Distinguishes a correctly configured proxy/backend key from a generic401.
        check(
            'web_proxy_requires_user_session',
            lambda: denied(web + '/api/backend/bootstrap', 'Sign in to continue'),
        )
        check(
            'web_proxy_rejects_invalid_session',
            lambda: denied(
                web + '/api/backend/bootstrap', 'Session expired or invalid', 'invalid-session'
            ),
        )
        if token:

            def authenticated():
                data = get(client, web + '/api/backend/bootstrap', token=token)
                require(
                    data.get('auth_mode') == 'supabase' and isinstance(data.get('projects'), list),
                    'Signed-in bootstrap did not confirm Supabase identity routing',
                )

            check('signed_in_web_to_api', authenticated)
    except VerificationError as exc:
        return {'status': 'failed', 'passed': checks, 'failure': str(exc)}
    return {'status': 'passed', 'passed': checks}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--web-url', default='', help='Web origin; blank defaults to local Docker port 3000'
    )
    parser.add_argument(
        '--api-url', default='', help='API origin; blank defaults to local Docker port 8000'
    )
    parser.add_argument(
        '--authenticated',
        action='store_true',
        help='Also use WORKBENCH_ACCESS_TOKEN from the process environment',
    )
    parser.add_argument(
        '--output', type=Path, default=ROOT / '.runtime/deployment-verification/result.json'
    )
    args = parser.parse_args(argv)
    try:
        web, api, local = targets(args.web_url, args.api_url)
        require(
            not local or not args.authenticated, 'Authenticated checks require hosted HTTPS origins'
        )
        token = os.environ.get('WORKBENCH_ACCESS_TOKEN', '') if args.authenticated else None
        require(
            not args.authenticated or token and not any(c.isspace() for c in token),
            'Authenticated check requires a valid WORKBENCH_ACCESS_TOKEN environment value',
        )
        with httpx.Client(
            timeout=15, verify=True, trust_env=False, follow_redirects=False
        ) as client:
            result = verify(client, web, api, token, local=local)
        result.update(
            checked_at=datetime.now(timezone.utc).isoformat(),
            web_origin=web,
            api_origin=api,
            target='local_docker' if local else 'hosted',
            authenticated_check='requested' if args.authenticated else 'not_requested',
            writes_performed=False,
            provider_calls=False,
            not_verified=[
                'browser sign-in/redirects',
                'two-user row/storage isolation',
                'research/evaluation worker execution',
                'SMTP delivery',
                'paid-provider quality',
                'production capacity/availability',
            ],
        )
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + '\n')
        for name in result['passed']:
            print('PASS: ' + name)
        if result['status'] == 'failed':
            print('FAIL: ' + result['failure'])
            return 1
        print(
            'PASS: read-only '
            + ('local Docker' if local else 'deployment')
            + ' checks; full hosted acceptance remains separate'
        )
        return 0
    except (VerificationError, OSError) as exc:
        print(
            'FAIL: '
            + (
                str(exc)
                if isinstance(exc, VerificationError)
                else 'Could not write the verification summary'
            )
        )
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
