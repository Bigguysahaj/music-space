#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/env.sh"
python3 "$MUSIC_SPACE_ROOT/scripts/gallery.py"
export MUSIC_SPACE_OUTPUT_DIR="$MUSIC_SPACE_ROOT/outputs"
exec "$MUSIC_SPACE_ROOT/vendor/yue2.cpp/build/yue-server" \
  --model "$MUSIC_SPACE_ROOT/models/YuE2-3B-Q5_K_M.gguf" \
  --vae "$MUSIC_SPACE_ROOT/models/YuE2-Vae-F32.gguf" \
  --host 127.0.0.1 --port 8087 --max-batch 1 --max-seq 4096 --vae-core 128
