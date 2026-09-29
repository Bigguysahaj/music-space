#!/usr/bin/env bash
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
destination="$root/cloudflare/.auth.env"

read -r -s -p 'Paste your Cloudflare API token here (it will not be displayed): ' token
printf '\n'
if [[ -z "$token" ]]; then
  printf 'No token entered. Nothing was saved.\n' >&2
  exit 1
fi

umask 077
printf 'export CLOUDFLARE_API_TOKEN=%q\n' "$token" > "$destination"
printf 'Saved the token in cloudflare/.auth.env. It is ignored by Git.\n'
