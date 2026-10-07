# ADR 001: Supabase for database, auth and private objects

Status: selected; hosted behavior unverified.

The workbench needs accounts, memberships, relational provenance, vector retrieval and private source bytes. Supabase combines Postgres/pgvector, Auth, RLS and Storage behind one production authorization model. A small SQL repository keeps worker operations scoped even when its connection is privileged. Local development uses plain pgvector Postgres and the same object-storage interface with a filesystem volume.

Neon is a reasonable database-focused alternative. It would require separately selected auth and object storage and equivalent token/membership/storage-access enforcement. It is documented as an alternative, not installed as a second mandatory database. The tradeoff is Supabase integration work and the need to test both RLS and application authorization.
