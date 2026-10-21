#!/bin/sh
set -eu
cat > /app/normalize.py <<'PY'
def normalize(values):
    seen = set()
    result = []
    for value in values:
        if not isinstance(value, str):
            continue
        value = value.strip().lower()
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result
PY
