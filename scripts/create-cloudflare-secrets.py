#!/usr/bin/env python3
"""Create private credentials for the hosted phone prototype."""
import json
import os
from pathlib import Path
import secrets


root = Path(__file__).resolve().parent.parent
path = root / "cloudflare" / ".local-secrets.json"
values = {
    "app_password": secrets.token_urlsafe(32),
    "bridge_token": secrets.token_urlsafe(32),
}
try:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    raise SystemExit("Private credentials already exist; keeping them unchanged.")
with os.fdopen(descriptor, "w", encoding="utf-8") as target:
    json.dump(values, target)
    target.write("\n")
print("Created private credentials in cloudflare/.local-secrets.json")
