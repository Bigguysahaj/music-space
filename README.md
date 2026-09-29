# Local Krishna mantra generation

YuE2 running in WSL on an RTX 3050 4 GB. The original mantra collection is in `lyrics.json`; the engine request is in `requests/krishna-10s.json`.

## Verified first run — 2026-09-23

- Successful CUDA generation, no out-of-memory errors.
- Output: `outputs/krishna-20260923-192127-95588.wav`.
- Duration: 9.9987 seconds, 48 kHz stereo, 16-bit PCM, non-silent.
- Pipeline reported 14.7 seconds; benchmark wall time was 15.85 seconds including monitoring overhead.
- Peak sampled **total** GPU memory: 2,491 MiB, sampled about once per second. This includes other GPU use and can miss short peaks.
- Musical quality and Sanskrit pronunciation have not been listening-verified.
- Full measurements: `outputs/benchmark.json`; run log: `logs/benchmark.log`.

Repeat the measured run with `python3 scripts/benchmark.py`. Each generation gets a fresh audio filename; the benchmark report and benchmark log are replaced on each benchmark run.

## Generate

The current default is **Romanized, solo adult female recitation with a loop copy**, from `requests/krishna-female-loop.json`. Run `bash scripts/generate.sh`. It saves both raw audio and a `-loop.wav` version and refreshes Saved music. The requested sound is sweet, clear, calming and unaccompanied; those voice qualities and pronunciation require listening confirmation.

In Saved music, **Loop playback** toggles repetition. It starts enabled for prepared loop files. `scripts/make-loop.py` removes only detected quiet edges and applies 15ms fades to reduce boundary clicks; it does not identify sung words or guarantee a musically seamless phrase. The initial female take had no removable quiet edges, so its loop copy remains 35 seconds. To choose a boundary after listening, use `python3 scripts/make-loop.py outputs/YOUR_FILE.wav --start SECONDS --end SECONDS`, then `python3 scripts/gallery.py`.

Pronunciation comparison after the user reported gibberish in the rhythmic take:

```bash
bash scripts/generate.sh requests/krishna-35s-devanagari.json
bash scripts/generate.sh requests/krishna-35s-phonetic.json
```

These matched 35-second requests use the minimal recitation style, two mantra repetitions, no fixed melody, CFG 1.2 and seeds 45. Only the lyric writing system differs. “Romanized input” uses an approximate phonetic spelling, not a translation or a guarantee of correct Sanskrit. Both generated successfully under 2.8 GiB sampled GPU memory. Listen to compare lyric intelligibility; generation success does not verify the words.

For the newer, shorter rhythmic chant trial (120 BPM score, four lyric lines, no vocal rests):

```bash
bash scripts/generate.sh requests/krishna-20s-rhythmic.json
```

Its first output is `outputs/krishna-20260923-204658-99727.wav` (20 seconds, generated in 22.16 seconds). This is a listening candidate; vocal accuracy and actual pacing are not verified from the audio.

```bash
cd /home/bigguysahaj/github/music-space
bash scripts/generate.sh
```

Audio and its replay JSON go to `outputs/`. Generation logs go to `logs/`. The earlier request `requests/krishna-recitation.json` uses: full Krishna mantra in four lines, quick lightly intoned delivery, minimal accompaniment, no fixed melody, and a 20-second cap. The model may end after 8 seconds; the first take filled the 20-second cap. The browser labels this take “Light recitation”. Actual vocal delivery still needs listening review. The older 40-second score-based request remains available. The original 10-second request remains available. Fixed seeds are 42; change both for a new take. A duration cap can cut off a phrase; it does not guarantee that the model will finish the lyrics naturally. Sanskrit pronunciation needs listening review.

The user reported no lyrics in the first clip. Its saved score scheduled nine bars of vocal rests (about 26 seconds at 84 BPM in 4/4), explaining why a 10-second cap could precede the vocals. The edited 40-second request begins with vocal notes in the score, but actual vocal timing still needs listening review. The new run succeeded in 36.81 seconds with a sampled total GPU peak of 2,478 MiB; output: `outputs/krishna-20260923-195940-97957.wav`. Earlier benchmark files are preserved as `outputs/benchmark-10s.json` and `logs/benchmark-10s.log`.

To use a different request:

```bash
bash scripts/generate.sh requests/your-request.json
```

## Browser interface

The latest command-line output is available at http://localhost:8087/outputs/. Click **Saved music** at the bottom right of the generator to open this library. It lists saved WAV/MP3 files newest first with playback, audio downloads, and replay settings. The library refreshes after each successful `scripts/generate.sh` run and on server startup. After manually adding audio files, run `python3 scripts/gallery.py` and refresh the page. Browser-generated songs still appear in the generator's own song list; the saved-file library lists files in `outputs/`.

```bash
bash scripts/serve.sh
```

Open http://localhost:8087 on this computer. Click **Open** in the prompt toolbar and select `requests/krishna-10s.json` to load the tested settings. The browser has its own defaults and does not automatically load this file. Importing it also applies the smaller planning budget required by our context limit. Run either the CLI or a browser generation at a time on this 4 GB GPU. Stop the server with Ctrl+C.

## Phone-to-laptop prototype

An early remote prototype is being prepared in `cloudflare/`. It hosts a small request page on Cloudflare and stores queued jobs and completed audio there. A connector running on this laptop checks for work over outbound HTTPS and runs the local generator. The laptop does not accept inbound connections, and the generation server is not made public. The phone page stays hosted, while generation only works when the laptop and connector are online. Setup and current limits are in [cloudflare/README.md](cloudflare/README.md). Future product experience and packaging ideas are tracked in [future.md](future.md).

## Memory settings

- Q5_K_M backbone; full precision VAE model file.
- 4,096-token context and one song per request.
- CFG 1.0 to use one guidance branch.
- 128-frame decoder tiles with the engine's default halo.
- Default strict stage eviction; no keep-loaded option.
- Melody planning capped at 1,024 tokens; semantic generation at 250 frames (25 per second).

These settings reduce peak VRAM but do not combine system RAM and VRAM into a single pool. Weights are loaded between stages. GPU calculation still needs its active buffers to fit. `steps` controls refinement work and quality, not the size of model weights.

## Reuse the build tools elsewhere in WSL

```bash
source /home/bigguysahaj/github/music-space/scripts/env.sh
nvcc --version
cmake --version
g++ --version
```

This makes the local CUDA 12.4 toolkit, CMake and Ninja available in that shell. GCC 9.4 is the existing system compiler. Other CUDA/C++ projects can use these tools if their version requirements match. No Windows NVIDIA driver was installed or replaced. Keep this project at its current path: the local toolchain contains absolute paths.

Rebuild this project's two executables with `bash scripts/build.sh`. The build targets GPU architecture 86 (RTX 3050), uses eight compiler jobs, and keeps FlashAttention enabled. GPU compilation can take several minutes on the first build; subsequent unchanged builds are incremental.

Before building, `scripts/prepare-web.py` applies the local Saved music extension: a link in the embedded page and an output-directory mount in the server. The server launcher sets that directory explicitly. This extension is repeatable and avoids rebuilding the frontend with npm.

## Sources

- Engine: https://github.com/ServeurpersoCom/yue2.cpp
- Engine revision: `ea07706f4958a9594f4ef1dd185e5ce1b5ab1175`
- GGML revision: `0af0d7d5f66a6976b259b292cb4e7dc60457aa45`
- Models: https://huggingface.co/Serveurperso/YuE2-GGUF
- Backbone file: `YuE2-3B-Q5_K_M.gguf`
- Decoder file: `YuE2-Vae-F32.gguf`

The engine and large downloaded files are ignored by the outer repository. Local generation uses your hardware, not OpenAI API tokens.

`toolchain-linux-64.lock` records the installed tool packages. `models-manifest.json` records locally calculated file sizes and SHA-256 checksums (these are reproducibility records, not independently authenticated publisher signatures).
