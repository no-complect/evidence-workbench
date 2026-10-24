"""Read-only HTTPS checks for an already deployed web/API pair; no inference or writes."""
import argparse
from datetime import datetime, timezone
import ipaddress
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

import httpx

ROOT = Path(__file__).resolve().parents[1]
MAX_RESPONSE_BYTES = 2 * 1024 * 1024


class VerificationError(RuntimeError):
    """Only fixed, credential-free messages may cross the CLI boundary."""


def require(condition, message):
    if not condition:
        raise VerificationError(message)


def origin(value):
    """Accept explicit HTTPS origins, never token-bearing URLs or local demo hosts."""
    try:
        parsed = urlsplit(value)
        host = parsed.hostname or ''
        port = parsed.port
        require(parsed.scheme == 'https' and host and parsed.username is None
                and parsed.password is None and parsed.path in {'', '/'}
                and not parsed.query and not parsed.fragment and not any(
                    char.isspace() or char == '\\' for char in value),
                'Use an HTTPS origin without credentials, path, query or fragment')
        require(host != 'localhost' and not host.endswith(('.localhost', '.local')),
                'Deployment verification requires a public HTTPS origin')
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            require('.' in host and all(part and all(
                char.isascii() and (char.isalnum() or char == '-') for char in part)
                for part in host.split('.')), 'Deployment hostname is invalid')
        else:
            require(address.is_global, 'Deployment verification requires a public HTTPS origin')
        authority = f'[{host}]' if ':' in host else host
        return 'https://' + authority + (f':{port}' if port and port != 443 else '')
    except ValueError:
        raise VerificationError('Deployment origin is invalid') from None


def get(client, url, *, status=200, token=None, html=False):
    # Fixed paths, GET only, no shared backend/service-role/provider credentials.
    headers = {'Authorization': f'Bearer {token}'} if token else {}
    try:
        with client.stream('GET', url, headers=headers, follow_redirects=False) as response:
            require(response.status_code == status,
                    'Unexpected HTTP status; check routing, protection and service configuration')
            chunks, size = [], 0
            for part in response.iter_bytes():
                size += len(part)
                require(size <= MAX_RESPONSE_BYTES, 'Deployment response exceeded the read limit')
                chunks.append(part)
            body = b''.join(chunks)
            if html:
                require('text/html' in response.headers.get('content-type', ''),
                        'Web origin did not return HTML')
                require(b'<title>Evidence Workbench</title>' in body,
                        'Web origin did not return the Evidence Workbench page')
                return None
            require('application/json' in response.headers.get('content-type', ''),
                    'API route did not return JSON')
            try:
                data = json.loads(body)
            except (ValueError, UnicodeError):
                raise VerificationError('API route returned invalid JSON') from None
            require(isinstance(data, dict), 'API route returned an unexpected JSON shape')
            return data
    except httpx.HTTPError:
        # HTTP exceptions can include URLs and Authorization headers. Never print them.
        raise VerificationError('HTTPS request failed; check DNS, certificates and connectivity') from None


def verify(client, web, api, token=None):
    checks = []

    def check(name, action):
        action()
        checks.append(name)

    try:
        check('web_html', lambda: get(client, web + '/', html=True))

        def health():
            data = get(client, api + '/health')
            require(data.get('status') == 'ok' and isinstance(data.get('version'), str),
                    'API/database readiness did not pass')

        check('api_database_readiness', health)

        def denied(url, detail, bearer=None):
            data = get(client, url, status=401, token=bearer)
            require(data.get('detail') == detail,
                    'Authentication boundary returned an unexpected response')

        check('direct_api_requires_backend_key', lambda: denied(
            api + '/api/bootstrap', 'Backend authentication required'))
        # Distinguishes a correctly configured proxy/backend key from a generic401.
        check('web_proxy_requires_user_session', lambda: denied(
            web + '/api/backend/bootstrap', 'Sign in to continue'))
        check('web_proxy_rejects_invalid_session', lambda: denied(
            web + '/api/backend/bootstrap', 'Session expired or invalid', 'invalid-session'))
        if token:
            def authenticated():
                data = get(client, web + '/api/backend/bootstrap', token=token)
                require(data.get('auth_mode') == 'supabase'
                        and isinstance(data.get('projects'), list),
                        'Signed-in bootstrap did not confirm Supabase identity routing')

            check('signed_in_web_to_api', authenticated)
    except VerificationError as exc:
        return {'status': 'failed', 'passed': checks, 'failure': str(exc)}
    return {'status': 'passed', 'passed': checks}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--web-url', required=True, help='Deployed HTTPS web origin')
    parser.add_argument('--api-url', required=True, help='Deployed HTTPS API origin')
    parser.add_argument('--authenticated', action='store_true',
                        help='Also use WORKBENCH_ACCESS_TOKEN from the process environment')
    parser.add_argument('--output', type=Path,
                        default=ROOT / '.runtime/deployment-verification/result.json')
    args = parser.parse_args(argv)
    try:
        web, api = origin(args.web_url), origin(args.api_url)
        token = os.environ.get('WORKBENCH_ACCESS_TOKEN', '') if args.authenticated else None
        require(not args.authenticated or token and not any(c.isspace() for c in token),
                'Authenticated check requires a valid WORKBENCH_ACCESS_TOKEN environment value')
        with httpx.Client(timeout=15, verify=True, trust_env=False, follow_redirects=False) as client:
            result = verify(client, web, api, token)
        result.update(
            checked_at=datetime.now(timezone.utc).isoformat(), web_origin=web, api_origin=api,
            authenticated_check='requested' if args.authenticated else 'not_requested',
            writes_performed=False, provider_calls=False,
            not_verified=['browser sign-in/redirects', 'two-user row/storage isolation',
                          'research/evaluation worker execution', 'SMTP delivery',
                          'paid-provider quality', 'production capacity/availability'])
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + '\n')
        for name in result['passed']:
            print('PASS: ' + name)
        if result['status'] == 'failed':
            print('FAIL: ' + result['failure'])
            return 1
        print('PASS: read-only deployment checks; full hosted acceptance remains separate')
        return 0
    except (VerificationError, OSError) as exc:
        print('FAIL: ' + (str(exc) if isinstance(exc, VerificationError)
                          else 'Could not write the verification summary'))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
