from .config import ROOT, DEMO_USER, DEMO_PROJECT, DEMO_COLLECTION, settings
from .ingest import MANIFEST, ingest
from . import db


def seed():
    if settings().auth_mode != 'demo' or settings().app_env not in {'local', 'test'}:
        raise ValueError('Demo seed is restricted to local/test authentication')
    db.migrate()
    db.execute('INSERT INTO projects(id,name) VALUES(%s,%s) ON CONFLICT DO NOTHING',
               (DEMO_PROJECT, 'Enterprise AI architecture'))
    db.execute("INSERT INTO project_memberships VALUES(%s,%s,'owner') ON CONFLICT DO NOTHING",
               (DEMO_PROJECT, DEMO_USER))
    db.execute(
        "INSERT INTO collections(id,project_id,name,embedding_config) VALUES(%s,%s,%s,'demo-v1') ON CONFLICT DO NOTHING",
        (DEMO_COLLECTION, DEMO_PROJECT, 'Architecture decision pack'))
    for meta in MANIFEST['documents']:
        path = ROOT / 'fixtures/corpus' / meta['file']
        present = db.one(
            'SELECT current_version_id FROM source_documents WHERE project_id=%s AND collection_id=%s AND name=%s',
            (DEMO_PROJECT, DEMO_COLLECTION, path.name))
        if not present or not present['current_version_id']:
            ingest(DEMO_PROJECT, DEMO_COLLECTION, path.name, path.read_bytes(), meta)
    print('Seeded 10 synthetic documents idempotently.')


if __name__ == '__main__':
    seed()
