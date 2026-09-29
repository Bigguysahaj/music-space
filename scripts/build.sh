#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/env.sh"
python3 "$MUSIC_SPACE_ROOT/scripts/prepare-web.py"
# Avoid CMake scanning inherited Windows PATH directories for every CUDA library.
export PATH="$CUDA_HOME/bin:/usr/local/bin:/usr/bin:/bin"
cmake -S "$MUSIC_SPACE_ROOT/vendor/yue2.cpp" -B "$MUSIC_SPACE_ROOT/vendor/yue2.cpp/build" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=86 \
  -DCMAKE_CUDA_COMPILER="$CUDACXX" -DCUDAToolkit_ROOT="$CUDA_HOME" \
  -DCMAKE_EXE_LINKER_FLAGS="-L$CUDA_HOME/lib -Wl,-rpath,$CUDA_HOME/lib" \
  -DCMAKE_SHARED_LINKER_FLAGS="-L$CUDA_HOME/lib -Wl,-rpath,$CUDA_HOME/lib" \
  -DGGML_CUDA_FA_ALL_QUANTS=OFF
cmake --build "$MUSIC_SPACE_ROOT/vendor/yue2.cpp/build" --target yue-synth yue-server yue-plan -j 8
