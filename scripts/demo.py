import time
import httpx
from workbench.models import DEFAULT_QUESTION
from workbench.config import settings, DEMO_PROJECT, DEMO_COLLECTION
from workbench.db import uid

client = httpx.Client(base_url='http://localhost:8000',
                      headers={'X-Workbench-Key': settings().api_shared_secret},
                      timeout=15)
response = client.post(f'/api/projects/{DEMO_PROJECT}/runs',
                       json={
                           'collection_id': DEMO_COLLECTION,
                           'question': DEFAULT_QUESTION,
                           'approve_plan': False,
                           'idempotency_key': uid()
                       })
response.raise_for_status()
run_id = response.json()['id']
print(f'Queued {run_id}. Progress is durable; the worker does not depend on this process.')
for _ in range(150):
    response = client.get(f'/api/projects/{DEMO_PROJECT}/runs/{run_id}')
    response.raise_for_status()
    data = response.json()
    status = data['run']['status']
    if status in {'completed', 'partial', 'failed', 'cancelled'}:
        print(f'Status: {status}; evidence passages: {len(data["evidence"])}')
        if data['run']['report']:
            report = client.get(f'/api/projects/{DEMO_PROJECT}/runs/{run_id}/report.md')
            report.raise_for_status()
            print(report.text)
        raise SystemExit(0 if status == 'completed' else 1)
    time.sleep(1)
raise SystemExit('Timed out waiting; inspect docker compose logs worker')
