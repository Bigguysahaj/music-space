#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/env.sh"
audio="${1:?usage: transcribe.sh <audio.wav|.mp3> [melody-only:true|false] [out-path]}"
melody_only="${2:-true}"
out="${3:-$MUSIC_SPACE_ROOT/outputs/transcribe-$(date +%Y%m%d-%H%M%S)-$$.abc}"
mkdir -p "$MUSIC_SPACE_ROOT/outputs" "$MUSIC_SPACE_ROOT/logs"
args=(--model "$MUSIC_SPACE_ROOT/models/SheetSage2-Q8_0.gguf" --audio "$audio" --out "$out")
[ "$melody_only" = "true" ] && args+=(--melody-only)
"$MUSIC_SPACE_ROOT/vendor/yue2.cpp/build/yue-transcribe" "${args[@]}" 1>&2
printf '%s\n' "$out"
