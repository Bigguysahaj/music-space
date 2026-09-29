#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/env.sh"
request="${1:-$MUSIC_SPACE_ROOT/requests/krishna-female-loop.json}"
stamp="$(date +%Y%m%d-%H%M%S)-$$"
output="$MUSIC_SPACE_ROOT/outputs/krishna-$stamp.wav"
mkdir -p "$MUSIC_SPACE_ROOT/outputs" "$MUSIC_SPACE_ROOT/logs"
"$MUSIC_SPACE_ROOT/vendor/yue2.cpp/build/yue-synth" \
  --model "$MUSIC_SPACE_ROOT/models/YuE2-3B-Q5_K_M.gguf" \
  --vae "$MUSIC_SPACE_ROOT/models/YuE2-Vae-F32.gguf" \
  --request "$request" --max-seq 4096 --vae-core 128 \
  --out "$output" \
  2> >(tee "$MUSIC_SPACE_ROOT/logs/generate-$stamp.log" >&2)
if python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1])).get("_music_space", {}).get("prepare_loop") else 1)' "$request"; then
  python3 "$MUSIC_SPACE_ROOT/scripts/make-loop.py" "$output"
fi
python3 "$MUSIC_SPACE_ROOT/scripts/gallery.py"
