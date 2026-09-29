# Feature spec: reference-audio → melody transcription ("hum-to-melody")

Handoff spec for implementation. Written for an agent with repo access to
`/home/bigguysahaj/github/music-space` (a self-hosted YuE2 song generator,
codenamed **Raagspace**). Read fully before writing code — later sections
depend on architecture facts established earlier.

## 1. Problem and why this approach

Goal: generate devotional songs whose melody/rhythm closely matches a real
reference tune (starting case: "Achyutam Keshavam" by Alka Yagnik), sung to
different lyrics (a Sanskrit/Hindi mantra) in a different voice.

Already tried and rejected:
- **Text style-tag nudging** ("melody in the character of X bhajan..."):
  confirmed not to reproduce a specific tune — it's a mood/tonality nudge,
  not melody control. This is `MELODY_PRESETS[i].text` in
  `cloudflare/public/index.html`.
- **Hand-transcribed ABC by ear**, adapted line-by-line to fit different
  lyrics' syllable counts: produced a take the user described as
  "cryptic" — likely compounding two known weaknesses: (a) a hand guess at
  notes never verified against the real recording, and (b) this project's
  already-logged Sanskrit/Hindi pronunciation problems (`PROJECT_STATUS.md`
  — Devanagari and Romanized lyrics have both produced unclear/gibberish
  vocals in past runs; YuE2's model card only lists `zh`/`en` support).
  Also: the existing verified preset's own UI copy already warns about
  this exact failure mode (`cloudflare/public/index.html` line 64):
  *"this score's notes are aligned syllable-by-syllable to its own
  original lyrics, so pairing it with different lyrics will likely put
  the wrong number of syllables under some phrases."*

**This feature replaces hand-guessed ABC with a real transcription** of
actual reference audio (an uploaded clip of the real song, or a hummed
melody recorded on the phone), using the transcriber the engine already
ships but this project has never wired up: **SheetSage2**, audio → ABC
score.

This does not fix Sanskrit/Hindi pronunciation — that is a separate,
already-tracked problem. Keep it out of scope here.

## 2. What already exists (do not rebuild)

### 2.1 Engine support (`vendor/yue2.cpp`, a submodule/vendored C++ port of YuE2 — do not edit its source, only add flags/consume its CLI and HTTP endpoints)

- **`yue-transcribe` CLI** (already built, see `vendor/yue2.cpp/docs/ARCHITECTURE.md` "yue-transcribe reference"):
  ```
  ./build/yue-transcribe --model <SheetSage2 gguf> --audio <file.wav|.mp3> [--melody-only] --out score.abc
  ```
  Input: any WAV or MP3, any rate, mono or stereo (auto-downmixed/resampled
  internally to 24kHz mono). Output: an ABC score file, the same format the
  `abc` field of a synth request already accepts. `--melody-only` omits
  chord symbols — **use this by default**: chords describe the original's
  harmony/instrumentation, which we're deliberately replacing with a new
  `style`; the melody-only score keeps vocal + instrumental voices only.

- **`yue-server --transcriber <gguf>`** enables an HTTP route:
  ```
  POST /transcribe   multipart/form-data: "audio" part (WAV/MP3), optional "melody_only" field
    -> {"id": "..."}                          (202-style async job)
  GET  /job?id=N                              poll {"status": "running|done|failed|cancelled"}
  GET  /job?id=N&result=1                     -> {"abc": "X:1\n..."}
  ```
  This is the **local/dev testing path** — no cloud round-trip needed to
  verify a transcription works before wiring the phone/cloud flow.

- **VRAM/scheduling**: the transcriber (`SheetSage2`) is its own model
  residency group, loaded only for a transcription and unloaded after
  (`docs/ARCHITECTURE.md`, "VRAM and model residency" — `EVICT_STRICT`
  default). It never coexists with the backbone LM/NAR halves in VRAM, so
  adding it does not raise the peak VRAM this project already budgets for
  on the 4GB card. The server itself is single-worker/FIFO already (one
  job at a time, `docs/ARCHITECTURE.md` "Concurrency") — a transcription
  job and a synthesis job cannot run concurrently on this laptop by
  construction, at the server level.

- **Model file**: not yet downloaded. `models/` currently has only
  `YuE2-3B-Q5_K_M.gguf` and `YuE2-Vae-F32.gguf` (see
  `models-manifest.json`). Need `SheetSage2-<quant>.gguf`.
  **Fetch it the same way the existing two files were almost certainly
  fetched** — the pre-converted public GGUF mirror, not the gated
  from-source checkpoint route:
  ```
  cd /home/bigguysahaj/github/music-space
  bash vendor/yue2.cpp/models.sh --quant Q8_0
  ```
  (`vendor/yue2.cpp/models.sh` writes to `./models/` relative to the
  **current working directory**, which is why running it from the project
  root — not from inside `vendor/yue2.cpp/`— lands files next to the
  existing two GGUFs. It skips files that already exist, so this is safe
  to run as-is.) Source repo: `Serveurperso/YuE2-GGUF` on Hugging Face,
  no gated terms, no `hf auth login` needed for this path.
  **Recommend `Q8_0`** (958 MB, "near lossless" per
  `vendor/yue2.cpp/README.md`) over matching the backbone's `Q5_K_M`:
  transcription quality directly determines melody fidelity, it only
  costs VRAM transiently during the transcribe step (evicted immediately
  after per above), and it's not resident during synthesis, so there's no
  reason to sacrifice accuracy for VRAM budget here. **Verify empirically
  first** — run the command above and confirm the file lands in
  `models/SheetSage2-Q8_0.gguf` before building anything else on top of
  this assumption; add its checksum to `models-manifest.json` the way the
  other two entries are recorded, once confirmed.
  A `--transcriber` fallback exists too (`checkpoints.sh` → `convert.py` →
  `quantize.sh`, gated HF terms + `hf auth login`) — only use this if the
  mirror route fails; not expected to be needed.

### 2.2 This project's existing job-queue architecture (the pattern to mirror)

Everything below already works for two job kinds, `generate` and `plan`.
The new kind should be built by mirroring `plan` end to end — same
shape, reversed audio direction (see §3).

- **Local CLI wrapper scripts** (`scripts/`), all thin wrappers around a
  `yue2.cpp` binary, all following the same shape (parse args with
  defaults, `mkdir -p outputs logs`, run binary, print/return output
  path):
  - `scripts/generate.sh` → `yue-synth`, writes a WAV to `outputs/`.
  - `scripts/plan.sh` → `yue-plan`, writes an ABC score to `outputs/`,
    **prints the output path to stdout** (its caller, `remote-bridge.py`,
    captures that path).
  - **No `scripts/transcribe.sh` exists yet — this is net-new, mirror
    `scripts/plan.sh`'s shape** but wrapping `yue-transcribe` and taking
    an audio file path as input instead of a request JSON.

- **`scripts/serve.sh`**: launches `yue-server` for local/dev use. Does
  **not** currently pass `--transcriber`, so `/transcribe` is disabled
  locally today. Add the flag once the model file exists.

- **D1 schema** (`cloudflare/migrations/`): `jobs` table
  (`0001_jobs.sql` + `0002_plan_jobs.sql`) — `id, kind, status, created_at,
  updated_at, request_json, audio_key, audio_name, result_text, error`.
  `kind` is a free-text column with `DEFAULT 'generate'`, **no CHECK
  constraint** — adding a new kind value needs no schema migration, only
  code-level handling of the new string. (A migration is still needed if
  you add a new column — see §3.2.)

- **Cloudflare Worker** (`cloudflare/src/index.js`, single file, ~180
  lines, read it in full before editing): routes are `/api/login`,
  `/api/jobs` (POST create, GET list), `/api/jobs/:id` (GET poll),
  `/api/jobs/:id/audio` (GET, fetches from the `AUDIO` KV/R2-style
  binding), and bridge-only routes under `/api/bridge/*` gated by a
  separate `BRIDGE_TOKEN` bearer (not the user's `APP_PASSWORD`):
  `claim` (POST, laptop pulls the next queued job), `jobs/:id/result` (PUT
  binary, for `generate`-kind jobs — rejects `kind === "plan"`),
  `jobs/:id/score` (PUT text, for `plan`-kind jobs — rejects
  `kind !== "plan"`), `jobs/:id/fail` (POST).
  **Gap for this feature**: `POST /api/jobs` today only accepts a JSON
  body (`{kind, request}`) — there is no path for the *phone* to upload
  binary audio at job-creation time. This is the one genuinely new piece
  of plumbing; everything else is close to a copy of the `plan` kind.
  See §3.2 for the exact contract to add.

- **Bridge** (`scripts/remote-bridge.py`, 150 lines, read in full): polls
  `/api/bridge/claim` in a loop, dispatches on `job["kind"]`
  (`handle_plan` vs `handle_generate`), runs the matching local script as
  a subprocess, uploads the result, cleans up temp files in a `finally`.
  Add `handle_transcribe`, dispatched the same way.

- **Frontend** (`cloudflare/public/index.html`, single static page, no
  build step, ~440 lines, read in full): the `#score-details` section
  already has the exact UI pattern to copy — `#plan-button` /
  `#plan-status` / `pollPlanJob()` (lines ~338–373) submits a `kind:
  'plan'` job, polls `GET /api/jobs/:id` every 2s up to a 120s deadline,
  and on `status: 'complete'` writes `job.resultText` into `#abc-score`
  (the same textarea `scoreField` that "Load verified score" also writes
  into). **The new feature's job should end at the same place**: filling
  `#abc-score`. Don't build a separate melody-preview UI — reuse this one.
  Also already present: a `MELODY_PRESETS` array with an `'achyutam'`
  entry carrying today's hand-transcribed (unverified-by-ear) ABC + its
  own matching lyrics, loadable via `#load-verified-score` — leave this
  alone; it's a reasonable fallback preset to keep, not something this
  feature needs to remove.

## 3. What to build

### 3.1 Two input modes, one job kind

Call the new kind **`"transcribe"`** (not `"hum"` — the near-term use case
is uploading an actual reference recording, not only humming; humming is
one input method among others, not the defining one).

- **Mode A — upload a file.** A standard `<input type="file" accept="audio/*">`
  on the phone page. This is the mode that matters for the immediate use
  case (transcribing the real "Achyutam Keshavam" recording). Build this
  first.
- **Mode B — record via mic.** `MediaRecorder` in the browser, a
  record/stop button, produces a `Blob` (webm/opus is fine — the engine
  resamples/downmixes on ingest regardless of input format... **verify**
  `yue-transcribe` actually accepts webm/opus, not just WAV/MP3 as
  `docs/ARCHITECTURE.md` states; if not, transcode client-side or restrict
  the recorder's `mimeType` to something the backend accepts, or transcode
  server-side in the bridge with `mp3-codec`/`ffmpeg` before calling
  `yue-transcribe`). This is the `future.md` "Hum-to-melody" feature and
  can land second — useful for capturing a melody from memory when no
  clean source recording exists, but not required for the Achyutam
  Keshavam case since a real recording is the actual input.

Both modes end up producing one audio `Blob`/file that gets uploaded
through the same job-creation contract (§3.2) — the UI difference is only
in how the client obtains the bytes.

### 3.2 Worker API contract (new/changed)

**New job creation flow for `kind: "transcribe"`** — needs to accept
binary audio, which the current `POST /api/jobs` (JSON-only body) cannot.
Recommended shape, chosen to reuse as much of the existing pattern as
possible (two-step create, mirroring how a `generate`/`plan` job's audio
result already flows *out* via a separate PUT):

1. `POST /api/jobs` — **unchanged JSON contract**, but allow
   `kind === "transcribe"`; for this kind, `request` should carry
   transcription options, not a synth request:
   ```json
   { "kind": "transcribe", "request": { "melody_only": true } }
   ```
   Validate `melody_only` is boolean if present (default `true`). Insert
   the job row with `status: 'queued'` as today. Response: `{id, status}`
   same as today.
2. **New route**: `PUT /api/jobs/:id/audio` (user-authed, i.e. behind
   `requireUser`, *not* the bridge auth) — uploads the reference audio for
   a job that's still `queued`. Mirror the existing size/type checks used
   for the bridge's `.../result` upload (25 MiB cap in that case; audio
   from a phone upload/recording should be capped similarly, e.g. 25 MiB,
   reject empty). Store it in the same `AUDIO` binding the way generated
   results already are (`env.AUDIO.put(key, bytes)`), key it e.g.
   `jobs/${id}/source.wav`, and record that key on the job row (needs a
   new column — see migration below). Reject if `job.status !== 'queued'`
   or `job.kind !== 'transcribe'`.
   Frontend calls step 1 then step 2 immediately (or combine into one
   multipart request if simpler — either is fine, pick whichever is less
   code; a single `POST /api/jobs` accepting `multipart/form-data` for
   this kind, carrying both a JSON `meta` part and an `audio` part, avoids
   the two-step race of "job exists but audio upload can still fail
   losing it" — **recommend this single-request form** unless it
   conflicts badly with the existing all-JSON `POST /api/jobs` code path;
   use your judgment, document which you picked).
3. **`POST /api/bridge/claim`** — needs to also return, for a
   `transcribe`-kind job, a way for the bridge to fetch the source audio
   (e.g. a `sourceAudioKey` or a short-lived signed URL, or just proxy it
   through a new bridge-authed route `GET /api/bridge/jobs/:id/audio`
   mirroring the shape of the user-facing `.../audio` route but gated by
   `requireBridge`).
4. **`PUT /api/bridge/jobs/:id/score`** — **already exists**, currently
   gated to `kind === "plan"` only (`cloudflare/src/index.js` line ~94).
   Relax that guard to accept `plan` OR `transcribe` (both kinds return a
   text score, same shape).
5. **`POST /api/bridge/jobs/:id/fail`** — already generic, no change
   needed.

**D1 migration** (new file, `cloudflare/migrations/0003_transcribe_jobs.sql`,
follow `0002`'s style — plain `ALTER TABLE`, no `CHECK` needed since `kind`
already has none):
```sql
ALTER TABLE jobs ADD COLUMN source_audio_key TEXT;
```

### 3.3 Bridge (`scripts/remote-bridge.py`)

Add `handle_transcribe(job, request_path, log_path)` mirroring
`handle_plan`: download the source audio (new API call to whatever route
§3.2 step 3 lands on), write it to `outputs/remote-{job_id}-source.<ext>`,
run `scripts/transcribe.sh` as a subprocess the same way `plan.sh` is
invoked, read the resulting `.abc` file, `PUT` it to
`.../jobs/:id/score` (already shared with `plan`), clean up both temp
files (source audio + request path) in a `finally`, matching existing
cleanup style. Add `"transcribe": handle_transcribe` dispatch in `handle()`
next to the existing `if kind == "plan"` branch.

### 3.4 New local script: `scripts/transcribe.sh`

Mirror `scripts/plan.sh`'s argument/defaults/output style:
```bash
#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/env.sh"
audio="${1:?usage: transcribe.sh <audio-file> [melody-only:true|false] [out-path]}"
melody_only="${2:-true}"
out="${3:-$MUSIC_SPACE_ROOT/outputs/transcribe-$(date +%Y%m%d-%H%M%S)-$$.abc}"
mkdir -p "$MUSIC_SPACE_ROOT/outputs" "$MUSIC_SPACE_ROOT/logs"
args=(--model "$MUSIC_SPACE_ROOT/models/SheetSage2-Q8_0.gguf" --audio "$audio" --out "$out")
[ "$melody_only" = "true" ] && args+=(--melody-only)
"$MUSIC_SPACE_ROOT/vendor/yue2.cpp/build/yue-transcribe" "${args[@]}" 1>&2
printf '%s\n' "$out"
```
(Sketch, not final — adjust flag/arg handling to match this project's
actual conventions once you're in the file; the point is: same shape as
`plan.sh`, prints the output path on stdout.)

Also add `--transcriber "$MUSIC_SPACE_ROOT/models/SheetSage2-Q8_0.gguf"`
to `scripts/serve.sh`'s `yue-server` invocation, so local/dev testing via
`POST /transcribe` on `yue-server` works without the cloud path.

### 3.5 Frontend (`cloudflare/public/index.html`)

In `#score-details`, next to the existing `#plan-button` row, add a new
control group:
- A file input (Mode A) and a record button (Mode B, can ship after A).
- A button ("Transcribe melody" or similar) that, once audio bytes are in
  hand, submits the job per the contract chosen in §3.2 and polls exactly
  like `pollPlanJob()` does — on completion, write the returned score into
  `#abc-score` (`scoreField.value = ...; updatePreview();`), same as
  today's plan flow. Reuse `pollPlanJob`'s polling loop/shape rather than
  writing a second one; parameterize by job id.
- Disable `#plan-button` and the new transcribe button while either is in
  flight (client-side only — the server is already serial per job, this
  is just to stop the user firing two overlapping client-side flows and
  confusing the polling state, not a backend safety requirement).
- Don't touch `#generate-button` — a transcription is a separate,
  cheaper preliminary step, same relationship "Draft a melody" already has
  to "Create music".

## 4. Non-functional requirements

- **Auth**: phone-originated requests (job creation, audio upload) go
  through `requireUser` (existing `APP_PASSWORD` bearer). Bridge-originated
  requests go through `requireBridge` (existing `BRIDGE_TOKEN` bearer).
  Do not mix these — follow the existing split exactly.
- **Size/type limits**: cap uploaded reference audio at 25 MiB (matches
  the existing `.../result` cap) and reject empty bodies, mirroring
  `cloudflare/src/index.js`'s existing checks almost verbatim.
- **Cleanup**: bridge must delete any temp files it wrote (source audio,
  request JSON) in a `finally`, matching `remote-bridge.py`'s existing
  pattern for `plan`/`generate`.
- **Error handling**: a failed transcription (bad audio, decode failure,
  timeout) must call the existing `.../fail` route with a useful message,
  same as `report_failure()` already does for the other kinds — no new
  failure-reporting mechanism needed.
- **No secrets in logs**: don't log audio bytes or auth headers; this
  already matches how `remote-bridge.py` logs today (subprocess stderr to
  a log file, nothing else).

## 5. Explicit non-goals

- Do not build dual-track/multi-stem ICL, arbitrary-length streaming
  transcription, or a general "upload any song, get any cover" product —
  scope is: get one melody's ABC out, feed it into the score box that
  already exists.
- Do not attempt to fix Sanskrit/Hindi pronunciation as part of this work
  — separate, already-tracked problem (`PROJECT_STATUS.md`).
- Do not touch `MELODY_PRESETS` / the existing `'achyutam'` verified-score
  preset — leave it as a fallback option, don't replace or "upgrade" it as
  part of this feature.
- Mic recording (Mode B) can ship after file upload (Mode A) — don't block
  the whole feature on `MediaRecorder` cross-browser quirks.

## 6. Acceptance criteria

1. `models/SheetSage2-Q8_0.gguf` present, checksum recorded in
   `models-manifest.json`.
2. `./build/yue-transcribe --model models/SheetSage2-Q8_0.gguf --audio
   <some real test clip> --melody-only --out /tmp/test.abc` produces a
   non-empty, syntactically plausible ABC file (has `X:`, `M:`, `K:`
   headers and at least one `V: Vocal` line with notes).
3. `scripts/transcribe.sh` wraps the above with the same ergonomics as
   `scripts/plan.sh`.
4. `bash scripts/serve.sh` (with `--transcriber` added) exposes
   `POST /transcribe` locally; a manual `curl -F audio=@clip.wav
   http://127.0.0.1:8087/transcribe` round-trips to a real ABC score via
   the job-poll endpoints.
5. End-to-end on the deployed Worker: phone uploads/records audio → job
   appears with `kind: "transcribe"` → running laptop bridge picks it up,
   runs the transcription, uploads the score → phone UI fills
   `#abc-score` with it, same place "Draft a melody" fills it today.
6. That transcribed ABC, paired with the Krishna mantra lyrics
   ("Om Krishnaaya Vaasudevaaya / Haraye Paramaatmane / Pranatah Klesha
   Naashaaya / Govindaaya Namo Namah") and a swapped voice in `style`,
   produces a `generate` take that a human listener confirms is
   recognizably closer to "Achyutam Keshavam" than the earlier
   hand-adapted attempt (`outputs/krishna-20260929-133246-53927.wav`) —
   this is a subjective listening check, not something to automate, but
   it's the actual bar for calling this feature done.

## 7. Open decisions left to the implementer

- Single combined `multipart/form-data` job-creation request vs. the
  two-step `POST /api/jobs` + `PUT .../audio` flow (§3.2 step 2) — pick
  one, document the choice inline in `cloudflare/src/index.js`.
- Whether the bridge fetches source audio via a proxied
  `GET /api/bridge/jobs/:id/audio` or via a field returned directly in
  the `claim` response — pick based on whichever fits the existing
  `remote-bridge.py` `call()` helper most naturally.
- Exact `MediaRecorder` MIME type / whether client-side transcoding is
  needed for Mode B (§3.1) — resolve by testing what `yue-transcribe`
  actually accepts; `docs/ARCHITECTURE.md` only documents WAV/MP3 input.
