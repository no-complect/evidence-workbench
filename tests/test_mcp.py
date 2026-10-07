import asyncio
import os
import socket
import subprocess
import sys
import time
import httpx
import pytest


@pytest.mark.integration
def test_real_mcp_client_calls_read_only_tools(client):
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    from workbench.config import DEMO_PROJECT, DEMO_COLLECTION, settings
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    server = subprocess.Popen([
        sys.executable, '-m', 'uvicorn', 'workbench.api:app', '--host', '127.0.0.1', '--port',
        str(port)
    ],
                              stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL)
    base = f'http://127.0.0.1:{port}'
    try:
        for _ in range(100):
            try:
                if httpx.get(base + '/health', timeout=.5).status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            time.sleep(.1)
        else:
            pytest.fail('MCP test API did not start')

        async def check():
            env = {
                **os.environ, 'WORKBENCH_API_URL': base,
                'WORKBENCH_PROJECT_ID': DEMO_PROJECT,
                'API_SHARED_SECRET': settings().api_shared_secret
            }
            params = StdioServerParameters(command=sys.executable,
                                           args=['-m', 'workbench.mcp_server'],
                                           env=env)
            async with stdio_client(params) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    tools = await session.list_tools()
                    assert {t.name
                            for t in tools.tools
                            } == {'corpus_search', 'evidence_lookup', 'run_status'}
                    result = await session.call_tool('corpus_search', {
                        'collection_id': DEMO_COLLECTION,
                        'query': 'security',
                        'top_k': 3
                    })
                    assert not result.isError
                    assert 'source_name' in result.content[0].text
                    denied = await session.call_tool('corpus_search', {
                        'collection_id': 'ffffffff-ffff-ffff-ffff-ffffffffffff',
                        'query': 'security'
                    })
                    assert denied.isError

        asyncio.run(check())
    finally:
        server.terminate()
        server.wait(timeout=10)
