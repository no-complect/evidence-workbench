# Measured fixture comparison

Evaluation e755e51f-67e9-42f5-9aa3-e350f134f6fe; split all. Scripted responses, synthetic sources, real Postgres and graph execution.

| Strategy | Cases | Recall@5 | MRR | Citation existence/access | Quote substring support | Completion | Mean seconds |
|---|---:|---:|---:|---:|---:|---:|---:|
| rag | 9 | 0.815 | 0.833 | 1.000 | 1.000 | 0.889 | 0.774 |
| workflow | 9 | 0.815 | 0.833 | 1.000 | 1.000 | 0.778 | 0.906 |
| bounded research | 9 | 0.815 | 0.833 | 1.000 | 1.000 | 0.667 | 1.009 |

Recall/MRR use the same independent retrieval probe for each strategy; they do not establish an iterative-research advantage. Completion includes intentional budget-stop cases. Quote checks are lexical support for literal excerpts, not an independent semantic assessment of synthesized claims. Reliability and isolation cases are separate integration tests. No live model quality claims.

```json
{
  "code_sha256": "ad04acd9d2270fae44004eedd11859f5c0c1a6c6c1d66b846602d5d5bff2fa3c",
  "corpus_sha256": "56a2944faccf3b354b4ade2ca8851c44b1ff4bb528bf38b2b8781925b4df179b",
  "corpus": "synthetic-corpus-v1",
  "model": "deterministic-fixture-v1",
  "embedding": "fixture-topic-vector-v1/16",
  "prompt_hashes": {
    "report-v1.md": "0880cc3b71892f0443a8269065742e0e805fd06ce8406a56732b9aebfb1e3ebf",
    "assess-v1.md": "a1a9f796f447abbad38fed2690ae8099106fbf78cfc0acb91d64ca301b63612e",
    "plan-v1.md": "b2bd8b022bf3fdf2a6784c20699e71da179c52725491f6551265ab5aff78d4ba",
    "judge-v1.md": "4732af4cea62cb6c4a9bc8278008f016f5f9dcd5689142199fc648d1f069670f"
  },
  "context_policy": "context-v2",
  "split": "all",
  "token_accounting": "conservative reservations; no provider tokens in demo",
  "semantic_judge": "none; exact quote substring checks only",
  "relevance_granularity": "manually labeled documents",
  "system_cases": "Separate integration tests; not silently counted as passed by this harness",
  "collection_id": "d9430af0-32ce-42b2-bc20-88a610f8b534",
  "source_hashes": [
    "24bbde75646b277ab2727c718053d023579e6ade7b53531b79051011c292da21",
    "1a91ddf75454468fee86335111afcced46d9216cf815b54c1395e9c15f1cfde9",
    "46d17c8408edb763ca6e290c991e407723c6874d9a6c1405cbe8c66325c6c238",
    "d1b4b3b5b8d6ae8cf512f9e18a1c158a2992c36c40184f1f9fae6731802bc777",
    "6e2d5b8903b6f472b56c721c1d8bffe9a06244785f25feda661f629008961480",
    "7a24827d679e851602a685b5b28ad0c36c8be9ec748543dba063ae3672c92e3c",
    "abdfe0e744a7ebd5f58dd1ad0311eb3168932087ce9ddfd97c6ff89c2ab10deb",
    "9d4076477c5f5c1f6eed7c62b8954daa03aacf03c8d1a105d6313e7c303d646c",
    "80eadc7256b2a35562f2d68c230d80e0fbae42d8f4e2df3ee3c402e7d96b01ec",
    "934efd7b3354d16d348fd2907d4c41604b97cd9ead3245408dd1aa1d3ee0e9e4"
  ]
}
```
