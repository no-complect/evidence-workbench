"""Validate complete provider catalogs without model-family/capability filtering."""


def parse_catalog(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get('data'), list):
        raise ValueError('Invalid model catalog')
    items = payload['data']
    if len(items) > 10000:
        raise ValueError('Model catalog exceeds the local safety limit')
    models = []
    for item in items:
        model_id = item.get('id') if isinstance(item, dict) else None
        if (not isinstance(model_id, str) or not model_id or len(model_id) > 1024
                or any(ord(char) < 32 or ord(char) == 127 for char in model_id)):
            # A partial list must never be presented as a successful full discovery.
            raise ValueError('Invalid model identifier in catalog')
        models.append(model_id)
    return sorted(set(models)), len(items)
