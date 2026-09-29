#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/env.sh"
request="${1:-$MUSIC_SPACE_ROOT/requests/krishna-female-loop.json}"
out="${2:-$MUSIC_SPACE_ROOT/outputs/plan-$(date +%Y%m%d-%H%M%S)-$$.abc}"
mkdir -p "$MUSIC_SPACE_ROOT/outputs" "$MUSIC_SPACE_ROOT/logs"
"$MUSIC_SPACE_ROOT/vendor/yue2.cpp/build/yue-plan" \
  --model "$MUSIC_SPACE_ROOT/models/YuE2-3B-Q5_K_M.gguf" \
  --request "$request" --max-seq 4096 \
  --out "$out" \
  1>&2
printf '%s\n' "$out"
