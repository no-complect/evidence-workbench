# Commutative/idempotent reducer: concurrent branches return IDs, never transcripts.
def merge_ids(left, right):
    return sorted(set(left or []) | set(right or []))
