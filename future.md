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

## Drag-to-fit editor (built, commit c2a67bd)

- Drag each syllable onto the notes it should hold; the score is rewritten to one note per syllable, with tie/slur fitting and a notation view. Spec and findings in `FIT_EDITOR_SPEC.md`.
- Deployed 2026-10-02 (Worker version f5f22f38; assets were already current). Still to do: confirm on a real phone.

## Hum-to-melody (built 2026-09-29, job kind `transcribe`)

- Done: `SheetSage2-Q8_0.gguf` downloaded, `yue-transcribe` built, worker route, D1 migration `0003` (applied remotely), bridge handler, mic/upload UI, in-browser WAV conversion, melody-check warnings. Melody checked by ear by the user.
- Open: test on a real phone; a transcribed intro stays as leading rests (the "Trim the intro" button is the workaround).

## Remote use

- The initial phone-to-laptop prototype uses a hosted control page and an outbound-only laptop connector. The laptop makes HTTPS requests to the hosted service, picks up a queued job, generates audio locally, then uploads the result. It does not accept inbound connections or run a public generation server.
- A later hosted connector architecture could support several computers or model backends, provided access control and private audio storage are designed first.
- Review retention controls, job cleanup, reconnect behavior, and account authentication before treating the remote service as a dependable personal app.
- Deprioritized (user, 2026-10-02): add a way to delete songs from the phone page: at minimum a "delete all" action, ideally per-song delete too. Needs a DELETE route in `cloudflare/src/index.js` that removes the D1 `jobs` row and the matching Workers KV `AUDIO` blob (`audio_key`); currently there is no delete endpoint or UI for this at all, only manual `wrangler d1 execute` / `wrangler kv key delete`.
- Move the personal prototype's audio from Workers KV to R2 if the 1 GB free KV storage allowance becomes limiting. R2 requires activation through Cloudflare checkout even though it has a free allowance.
