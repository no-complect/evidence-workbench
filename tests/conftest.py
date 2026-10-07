import os
import pytest


@pytest.fixture(scope='session')
def database():
    if os.environ.get('WORKBENCH_INTEGRATION') != '1':
        pytest.skip('Set WORKBENCH_INTEGRATION=1 against a dedicated pgvector test database')
    from workbench import db
    from workbench.seed import seed
    from workbench.worker import setup_checkpoints
    seed()
    setup_checkpoints()
    return db


@pytest.fixture
def client(database):
    from fastapi.testclient import TestClient
    from workbench.api import app
    from workbench.config import settings
    with TestClient(app, headers={'X-Workbench-Key': settings().api_shared_secret}) as client:
        yield client
