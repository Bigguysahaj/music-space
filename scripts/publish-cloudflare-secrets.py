#!/usr/bin/env python3
"""Publish local private credentials as Cloudflare Worker secrets."""
import json
from pathlib import Path
import subprocess


root = Path(__file__).resolve().parent.parent
secrets_path = root / "cloudflare" / ".local-secrets.json"
secrets = json.loads(secrets_path.read_text(encoding="utf-8"))

for name, field in (("APP_PASSWORD", "app_password"), ("BRIDGE_TOKEN", "bridge_token")):
    value = secrets[field]
    if not isinstance(value, str) or len(value) < 24:
        raise SystemExit(f"{field} is missing or too short")
    command = ["npx", "--yes", "wrangler", "secret", "put", name]
    result = subprocess.run(
        command,
        input=value + "\n",
        text=True,
        capture_output=True,
        cwd=root / "cloudflare",
        check=False,
    )
    if result.returncode:
        raise SystemExit(f"Could not publish {name}:\n{result.stderr.strip()}")
    print(f"Published {name}")
