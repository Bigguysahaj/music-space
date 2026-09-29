# Future directions

This file tracks product directions that are interesting but are outside the first remote prototype.

## Human music making experience

- Add a small set of useful starting points for spoken, lightly sung, and rhythmic music.
- Make lyrics, style, pacing, accompaniment, and duration easy to adjust, with advanced engine controls available when needed.
- Keep every take with its request and settings so versions can be replayed, compared, and varied.
- Show progress and useful output details, and collect feedback such as unclear pronunciation or a late vocal entrance.
- Explore a prompt helper that turns a plain-language idea into an editable request and explains the settings it chose.
- Use successful music creation apps such as Suno as inspiration for useful iteration and library workflows, without copying features that do not fit this local model.

## Packaging and sharing

- Prepare the open-source project for GitHub with a polished README, reliable setup instructions, and a project title image.
- Keep the local web app as the initial human interface. Consider a desktop launcher after the shared workflow is stable.
- Add a documented CLI and HTTP API for scripts and agents, then consider an MCP adapter.
- Keep the generation engine replaceable so another local model or generation service can be added later.

## Drag-to-fit editor (urgent next addition)

- Let a person drag each syllable onto the notes it should hold, and rewrite the score to one note per syllable. A same-seed A/B on 2026-09-29 made the words clear ("b is clear word for word"). Full handoff in `FIT_EDITOR_SPEC.md`.

## Hum-to-melody (audio reference transcription, built 2026-09-29)

- Let the phone page record a short mic clip (browser MediaRecorder), upload it as a new job kind, and have the laptop bridge run `yue-transcribe` (SheetSage2, needs `SheetSage2-Q8_0.gguf`, ~958 MB, not yet downloaded) to turn the hum into a real ABC score, dropped straight into the score box next to the existing "Draft a melody" flow.
- This is the deterministic alternative to the "melody character" style presets added 2026-09-25: those only nudge the model with adjectives and do not reliably reproduce a specific named tune (confirmed with Achyutam Keshavam — the preset text alone did not make the output sound like the real bhajan).
- While a hum is recording/uploading/transcribing, the main "Send to laptop" / "Draft a melody" controls should be disabled — the laptop's single GPU generation slot can't run a transcription and a synthesis job at once.
- Needs: a new job `kind: 'hum'` end to end (worker route + D1 + bridge handler, mirroring the `plan` kind added 2026-09-25), a mic-recording UI control, and building `yue-transcribe` plus fetching the transcriber model.

## Remote use

- The initial phone-to-laptop prototype uses a hosted control page and an outbound-only laptop connector. The laptop makes HTTPS requests to the hosted service, picks up a queued job, generates audio locally, then uploads the result. It does not accept inbound connections or run a public generation server.
- A later hosted connector architecture could support several computers or model backends, provided access control and private audio storage are designed first.
- Review retention controls, job cleanup, reconnect behavior, and account authentication before treating the remote service as a dependable personal app.
- Add a way to delete songs from the phone page: at minimum a "delete all" action, ideally per-song delete too. Needs a DELETE route in `cloudflare/src/index.js` that removes the D1 `jobs` row and the matching Workers KV `AUDIO` blob (`audio_key`); currently there is no delete endpoint or UI for this at all, only manual `wrangler d1 execute` / `wrangler kv key delete`.
- Move the personal prototype's audio from Workers KV to R2 if the 1 GB free KV storage allowance becomes limiting. R2 requires activation through Cloudflare checkout even though it has a free allowance.
