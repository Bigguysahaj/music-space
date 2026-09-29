# Current state

## Hosted phone prototype handoff (2026-09-24)

- Live app: https://music-space.singhsahaj2001.workers.dev
- Cloudflare device authorization, Worker deployment, D1 migration, KV namespace, and Worker secrets are complete. Do not ask the user to enter another Cloudflare device code just to use this deployment.
- The phone app's access password and the laptop bridge token are saved only in `cloudflare/.local-secrets.json` (mode 0600, ignored by Git). The same values are published as Cloudflare Worker secrets. Never commit or print the bridge token. To retrieve just the app password locally: `python3 -c 'import json; print(json.load(open("cloudflare/.local-secrets.json"))["app_password"])'`.
- Login and D1 job-list requests succeeded against the live app. The Python laptop bridge authenticated and polled the live queue successfully after adding a browser-compatible User-Agent header. No end-to-end remote audio generation has been performed yet.
- The laptop bridge must run whenever phone-submitted jobs should generate. Start it from the project root with `MUSIC_SPACE_WORKER_URL=https://music-space.singhsahaj2001.workers.dev bash scripts/remote-bridge.sh`. The laptop must stay awake and online. Closing the laptop or bridge does not delete the deployed app, queue, or saved secrets; queued work waits until the bridge returns.
- See `cloudflare/README.md` for architecture and setup, and `future.md` for later product ideas. Workers KV stores generated WAVs; R2 was deferred because the account requires subscription activation.

Latest preference: Romanized lyrics; short intro; easily loopable; voice only, sweet youthful adult female (user described 19-year-old, divine/calming/koyal-like human voice). Default is now `requests/krishna-female-loop.json`: no instruments/drone, solo adult feminine soprano requested, seeds45/CFG1.2/35sec/two rounds. Output raw `krishna-20260923-215844-103255.wav`; loop copy `krishna-20260923-215844-103255-loop.wav`. Render: 32.55sec, sampled GPU peak 2,784MiB. Audio character and vocal entrance not listening-verified. There were no quiet edges long enough for automatic trimming, so loop copy retains full duration (34.9987sec) with 15ms fade-in/out to reduce clicks. Never claim an actual intro was removed. `scripts/make-loop.py` supports optional listening-selected --start/--end seconds. Browser has Loop playback checkbox, enabled for loop-prepared files. Automated browser check verified actual wraparound, toggle, playback, seeking and mobile width. Default launcher now creates loop copy automatically via request `_music_space.prepare_loop`; original is preserved.

Latest: user reported gibberish specifically in rhythmic file `krishna-20260923-204658-99727.wav` and asked for 30–40 seconds. Explained that fixed experimental melody was not syllable-aligned and reliable Sanskrit support is unverified (official YuE2 card language metadata lists zh/en); duration alone cannot ensure pronunciation. Rendered matched 35-second tests without ABC: `requests/krishna-35s-devanagari.json` and `requests/krishna-35s-phonetic.json`, same style/seeds45/CFG1.2/two repetitions, only lyric script differs. Outputs: Devanagari `krishna-20260923-205437-100493.wav` (27.29 s compute, peak 2,826 MiB); Romanized `krishna-20260923-205504-100593.wav` (28.38 s compute, peak 2,818 MiB). Both are 34.9987 s and listed with distinct labels in Saved music. Pronunciation NOT verified; await user's comparison before claiming a fix or switching defaults. Benchmark now also saves a per-audio `.benchmark.json`.

User clarified desired style: quick spoken or lightly sung mantra with minimal music. Latest request and launcher default: `requests/krishna-recitation.json`. No fixed score (`cot=off`), quick syllabic lightly intoned solo voice, quiet tanpura, no percussion, four lyric lines; CFG 1, seeds 44, min 200/max 500 frames (8-second minimum, 20-second cap). Output `outputs/krishna-20260923-205209-100081.wav`: 19.9987 seconds, benchmark 21.16 seconds, sampled GPU peak 2,537 MiB. Browser labels it “Krishna mantra · Light recitation”. These are requested style characteristics, not listening-verified results. Await user feedback.

Latest listening feedback: the 40-second take was too slow and stretched the lyrics. User supplied https://www.youtube.com/shorts/_5LFNfa35qI (metadata: 20-second Krishna mantra clip). Metadata was retrieved, but the reference audio was NOT heard. Prepared and rendered `requests/krishna-20s-rhythmic.json`: original 120 BPM eight-bar vocal score without rests, four lyric lines, light tabla/manjira/harmonium style, 20-second cap with 14-second minimum. Output `outputs/krishna-20260923-204658-99727.wav` is 19.9987 seconds; generation benchmark 22.16 seconds; peak sampled GPU memory 2,437 MiB. It appears first in Saved music. Await user listening feedback; don't claim exact reference matching or verified pronunciation. Launcher default still points to the 40-second request until the user approves the new style.

Updated 2026-09-23. User wants a 10-second Krishna mantra clip and is learning the setup. Keep explanations practical and avoid unnecessary agent delegation or repeated checks.

Latest: user reported no lyrics in the 10-second clip and requested earlier vocals / 40 seconds. The saved ABC score had nine intro bars of vocal rests (~26 seconds). Created `requests/krishna-40s-vocals.json` with full mantra and the original verse-only melody, removing intro/outro; seeds 42, 1,000 semantic frames. Made it the generation launcher's default. New output `outputs/krishna-20260923-195940-97957.wav`: 39.9987 seconds, 36.81 seconds generation benchmark, peak sampled GPU memory 2,478 MiB. Library refreshed with two clips, latest first. Actual vocals/pronunciation still need user listening; don't claim listening verification.

## Working

- WSL Ubuntu 20.04, Ryzen 5 5600H, 15 GiB WSL RAM, RTX 3050 4 GB.
- Engine and GGML pinned by the cloned revisions in README.md.
- Local reusable CUDA 12.4 / CMake / Ninja toolchain in `.tools/cuda`; system GCC 9.4.
- `scripts/env.sh` exposes the toolchain to other WSL projects.
- `scripts/build.sh` builds `yue-synth` and `yue-server`. Windows PATH search slowdown and C++ runtime link mismatch were fixed in this script. `scripts/prepare-web.py` applies a repeatable server output-directory mount and Saved music link in the embedded frontend.
- Q5_K_M backbone and F32 VAE downloaded to `models/`.
- `scripts/generate.sh` runs `requests/krishna-10s.json` and writes uniquely named WAV and replay JSON files.
- First successful audio: `outputs/krishna-20260923-192127-95588.wav`.
- Measured 15.85 s wall time, sampled total GPU memory peak 2,491 MiB, 9.9987 s stereo WAV at 48 kHz. Non-silent, but pronunciation and musical quality need user listening.
- `scripts/serve.sh` starts a localhost-only browser interface at port 8087. Import the request through its Open button; upstream default planning budget is too large for our reduced context.
- Server started and checked: `/health` returned ok, `/props` returned model metadata, and the gzip-enabled page request returned HTTP 200. Plain curl without gzip receives 406 by design. Browser interaction itself was not automated.
- Added `http://localhost:8087/outputs/`, reached via Saved music in the generator. `scripts/gallery.py` renders saved-file players newest first, refreshed after successful CLI generations and at server startup. Browser-generated songs remain in the original browser song list.
- Follow-up browser check passed: clicked Saved music, loaded the 9.998667-second audio, playback advanced, range requests returned 206, and a 390-pixel viewport had no horizontal overflow. Server restarted with this extension.

## Important settings

4,096 context; VAE core 128; CFG 1; batch sizes 1; strict stage eviction; melody planning max 1,024 tokens; semantic min/max 250; duration 10; 32 refinement steps; seeds 42.

Original `lyrics.json` was preserved. The request uses only “ॐ कृष्णाय वासुदेवाय हरये परमात्मने।” to avoid rushing the full mantra.

GPU execution needs tool sandbox escalation; normal user execution in WSL can access the GPU. No OpenAI API key is needed for this local model. Model checksums and explicit tool package list are in `models-manifest.json` and `toolchain-linux-64.lock`.
