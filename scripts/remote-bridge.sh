#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/env.sh"
exec python3 "$MUSIC_SPACE_ROOT/scripts/remote-bridge.py"
