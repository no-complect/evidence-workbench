"""Public-only HTTP fetching with DNS-pinned connections and bounded redirects."""
import http.client
import ipaddress
import socket
import ssl
import time
from html.parser import HTMLParser
from urllib.parse import urlsplit, urljoin

MAX_FETCH_BYTES = 1_000_000


class WebPolicyError(ValueError):
    pass


def public_target(url):
    p = urlsplit(url)
    if p.scheme not in {'https', 'http'} or not p.hostname or p.username or p.password:
        raise WebPolicyError('Only public HTTP(S) URLs without credentials are allowed')
    if p.port not in {None, 80, 443} or p.hostname.endswith(('.local', '.internal', '.localhost')):
        raise WebPolicyError('Destination or port is not allowed')
    try:
        records = socket.getaddrinfo(p.hostname,
                                     p.port or (443 if p.scheme == 'https' else 80),
                                     type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise WebPolicyError('Destination could not be resolved') from exc
    ips = sorted({r[4][0] for r in records})
    if not ips or any(not ipaddress.ip_address(ip).is_global for ip in ips):
        raise WebPolicyError('Private, loopback, link-local, and reserved addresses are blocked')
    return p, ips[0]


class PinnedHTTPS(http.client.HTTPSConnection):

    def __init__(self, host, ip, port, timeout):
        super().__init__(host, port=port, timeout=timeout, context=ssl.create_default_context())
        self.pinned_ip = ip

    def connect(self):
        raw = socket.create_connection((self.pinned_ip, self.port), self.timeout)
        self.sock = self._context.wrap_socket(raw, server_hostname=self.host)


class TextHTML(HTMLParser):

    def __init__(self):
        super().__init__()
        self.hidden = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in {'script', 'style', 'noscript'}:
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag in {'script', 'style', 'noscript'}:
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden and data.strip():
            self.parts.append(data.strip())


def fetch_page(url):
    deadline = time.monotonic() + 20
    for _ in range(4):
        parsed, ip = public_target(url)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('Fetch deadline exceeded')
        port = parsed.port or (443 if parsed.scheme == 'https' else 80)
        conn = PinnedHTTPS(parsed.hostname, ip, port, min(
            6, remaining)) if parsed.scheme == 'https' else http.client.HTTPConnection(
                ip, port, timeout=min(6, remaining))
        try:
            conn.request('GET',
                         parsed.path + ('?' + parsed.query if parsed.query else '') or '/',
                         headers={
                             'Host': parsed.hostname,
                             'User-Agent': 'EvidenceWorkbench/0.1',
                             'Accept': 'text/html,text/plain',
                             'Accept-Encoding': 'identity'
                         })
            response = conn.getresponse()
            if response.status in {301, 302, 303, 307, 308}:
                location = response.getheader('Location')
                if not location:
                    raise WebPolicyError('Redirect has no destination')
                url = urljoin(url, location)
                continue
            if response.status != 200:
                raise WebPolicyError(f'Fetch returned HTTP {response.status}')
            media = response.getheader('Content-Type', '').split(';')[0]
            if media not in {'text/html', 'text/plain'} or response.getheader(
                    'Content-Encoding', 'identity') != 'identity':
                raise WebPolicyError('Only uncompressed HTML or text is supported')
            body = bytearray()
            while True:
                if time.monotonic() > deadline:
                    raise TimeoutError('Fetch deadline exceeded')
                part = response.read(min(16384, MAX_FETCH_BYTES + 1 - len(body)))
                if not part:
                    break
                body.extend(part)
                if len(body) > MAX_FETCH_BYTES:
                    raise WebPolicyError('Page exceeds 1 MB')
            text = body.decode('utf-8', errors='replace')
            if media == 'text/html':
                parser = TextHTML()
                parser.feed(text)
                text = '\n\n'.join(parser.parts)
            return {'url': url, 'text': text[:32000], 'truncated': len(text) > 32000}
        finally:
            conn.close()
    raise WebPolicyError('Too many redirects')


class TavilySearch:

    def search(self, query):
        import httpx
        from .config import settings
        key = settings().tavily_api_key
        if not key:
            raise ValueError('Web search requires TAVILY_API_KEY')
        response = httpx.post('https://api.tavily.com/search',
                              json={
                                  'api_key': key,
                                  'query': query,
                                  'max_results': 2,
                                  'search_depth': 'basic',
                                  'include_answer': False
                              },
                              timeout=15)
        response.raise_for_status()
        return [{
            'url': r['url'],
            'title': r['title']
        } for r in response.json().get('results', [])[:2]]
