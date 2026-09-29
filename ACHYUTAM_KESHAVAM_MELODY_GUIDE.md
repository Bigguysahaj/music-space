# Matching "Achyutam Keshavam" (Alka Yagnik) melody/rhythm in YuE2

Research notes for prompting the local `yue2.cpp` engine to reproduce this
song's melody and rhythm closely, with a different voice, for a different
mantra's lyrics (lyrics TBD). Two paths, in order of reliability.

## Why text style-tags alone won't do this

`future.md` already recorded the answer from an earlier attempt: adjective
style presets ("devotional", "bright", "brisk tempo"...) nudge mood and
instrumentation but do not reproduce a *specific named tune* — confirmed
with this exact song. That matches how the engine works
(`vendor/yue2.cpp/docs/ARCHITECTURE.md`): `style` and `lyrics` are the only
free-text inputs; the actual melody comes from the `abc` field (a score),
either written by the model itself in `cot=full`/`melody` mode, or supplied
by you. To get *close*, you need to supply the real melody as an `abc`
score, not describe it in prose.

## Path A — SheetSage2 transcription (recommended, deterministic)

The engine already has the tool for this and it's downloaded models, but
not the transcriber. `future.md`'s "Hum-to-melody" section flags this as
the deterministic alternative that hasn't been wired up yet.

1. **Get the transcriber model** (958 MB, gated on HF — needs `hf auth
   login` and accepting terms for `m-a-p/SheetSage2` and
   `m-a-p/MERT-v2-FullSong`):
   ```bash
   cd vendor/yue2.cpp
   ./checkpoints.sh   # or fetch SheetSage2-Q8_0.gguf directly per README.md
   ```
2. **Get a clean audio clip** of the actual Alka Yagnik / Sanjeev
   Chaturvedi recording — a source you have legitimate access to (see
   copyright note below). Trim to the mukhda + one verse (~20–40s is
   plenty; SheetSage2 windows at 300s anyway). WAV or MP3, any rate.
3. **Transcribe melody only** (skip chord symbols — you want the tune, not
   the original's harmony, since the voice/instrumentation will change):
   ```bash
   ./build/yue-transcribe \
     --model models/SheetSage2-Q8_0.gguf \
     --audio achyutam-clip.wav \
     --melody-only \
     --out achyutam-melody.abc
   ```
4. **Sanity-check the ABC by eye** against what's independently confirmed
   below (key, meter, tempo) before trusting it.
5. **Build the request**: drop the transcribed `abc` into a request JSON,
   `cot: "melody"` (README's own cover guidance: melody-only score, no
   chords, so the accompaniment can adapt to the new style), new `lyrics`,
   new `style` for the different voice. See template below.
6. Generate 2–4 candidates (`lm_batch_size`/reruns with different seeds)
   and compare — single-shot YuE2 output is inconsistent enough that this
   matters.

This is the only path that gets genuinely close, because it's the model's
own transcription of the model's own melody-scoring format, not a guess.

## Path B — Hand-built ABC (fallback, if no clean audio source)

`requests/achyutam-keshavam.json` already contains a **hand-transcribed,
unverified** attempt at the mukhda (`C2D2E2E4F2E2|...`, key C, 4/4,
`Q:1/4=100`, comment "2x note lengths"). It was written from ear/guesswork,
not confirmed against the real recording by listening, and no output file
in `outputs/` is tagged as coming from it — treat it as a draft, not a
verified transcription.

Independently confirmed facts about this specific recording, for
cross-checking or rewriting that ABC:

| Property | Value | Source |
|---|---|---|
| Composer | Sanjeev Chaturvedi (2021, Zee Music Devotional) | songbpm.com |
| Tempo | **93 BPM** | songbpm.com |
| Key | **E major** | songbpm.com |
| Time signature | 4/4, high energy, "very danceable" | songbpm.com |
| Likely taal feel | Keherwa (8-beat, two 4-beat halves) — the standard taal for this genre of Hindi bhajan/film-devotional; Dadra (6-beat) is the other common option for lighter bhajans but doesn't fit a 4/4-reported track | general taal reference, cross-checked against the 4/4 time signature |
| Commonly cited raga for the tune (not necessarily binding for this 2021 pop arrangement) | Raag Yaman | general search consensus; not confirmed against this specific recording |
| Lyrics origin | First verse is the opening of Adi Shankara's **Achyutashtakam** (Sanskrit, public domain); the Hindi bhajan's later verses are additions not from Shankara's text | Wikipedia: Achutam Keshavam |
| Recurring mukhda (the phrase to prioritize matching) | "Achyutam Keshavam Krishna Damodaram / Ram Narayanam Janaki Vallabham" | multiple lyric sites |

Free sargam/harmonium notation to hand-transcribe from (cross-reference
several, since fan transcriptions disagree on octave/key):
- https://notesandsargam.com/achyutam-keshavam/
- https://sangeetbook.com/achutam-keshavam-sargam-notes-in-hindi/
- http://notationzone.com/achyutam-keshavam-notes-for-flute-harmonium-keyboard/
- https://www.synthesizernotes.com/achyutam-keshavam-krishna-damodaram-harmonium.html (offers it pre-transposed to all 12 keys)

If hand-building: set `M:4/4`, pick a `Q:1/4=93` (or half/double per your
note-length convention, like the existing draft's "2x note lengths"), and
group notes into a Keherwa-feeling 8-beat pulse.

## Request template — melody locked, voice swapped

The engine cleanly separates "what melody" (`abc`) from "what it sounds
like" (`style` — genre/instruments/mood/vocal gender+timbre) from "what
words" (`lyrics`). That's exactly the split you asked for: keep the same
"trait" (the devotional-bhajan style block), swap only the vocal
gender/timbre words, and drop in a transcribed `abc`.

```json
{
  "style": "Devotional bhajan, warm harmonium and tabla, bright and uplifting, brisk skipping tempo, community singalong feel, [CHANGE THIS PART: e.g. deep clear man's voice / youthful bright male vocal]",
  "lyrics": "[Verse]\n[NEW MANTRA LINES GO HERE, one line per matched melodic phrase]",
  "cot": "melody",
  "abc": "[PASTE THE TRANSCRIBED OR HAND-BUILT MELODY-ONLY ABC HERE]",
  "duration": 30.0,
  "cfg_scale": 1.0,
  "output_format": "wav16"
}
```

Reuse `requests/achyutam-keshavam.json` as the starting point — its
`style` string is already this shape, it just needs the vocal-timbre words
swapped and a verified `abc`.

## The gotcha for when the new mantra lyrics arrive

`abc` and `lyrics` are aligned roughly one note-group (bar) per sung word/
phrase — this is a scored melody, not a backing track the model sings
over freely. **A different mantra will almost certainly have a different
syllable count per line than "Achyutam Keshavam Krishna Damodaram."** You
will need to manually re-bar the transcribed ABC line-by-line (add/remove
repeated or tied notes) so each bar's note count roughly matches the new
line's syllable count — reusing the ABC string byte-for-byte with
different-length lyrics will stretch or crowd the new words oddly. Do this
edit once the actual mantra text is in hand.

## A caveat already logged in this project

`PROJECT_STATUS.md` records that the official YuE2 model card only lists
`zh`/`en` for language support, and this project already hit intelligible
-vs-gibberish problems with Sanskrit/Hindi lyrics (both Devanagari and
Romanized spellings were tried; neither was confirmed clean by listening).
Getting the melody right does not fix pronunciation — expect to still need
a listening pass on lyric intelligibility once the new mantra is scored in,
independent of how well the melody matches.

## One-line copyright note

The mukhda's Sanskrit text (Achyutashtakam, Adi Shankara) is public domain.
The 2021 Sanjeev Chaturvedi tune and Alka Yagnik recording are not — closely
reproducing that melody is fine for personal/devotional practice, but worth
knowing if this is ever distributed or monetized rather than kept private.

## Sources

- [YuE2 Prompting Guide: Style Tags, Lyrics, and Planning Modes](https://songcreator.pro/blog/yue2-prompting-guide)
- [ComfyUI YuE2 Music Generation Guide](https://docs.comfy.org/tutorials/audio/yue2/yue2)
- [Prompt Engineering: Style and Lyrics — DeepWiki](https://deepwiki.com/multimodal-art-projection/YuE/4.3-prompt-engineering:-style-and-lyrics)
- `vendor/yue2.cpp/docs/ARCHITECTURE.md` (this repo's engine, request schema, transcriber)
- [BPM/key for Achyutam Keshavam by Alka Yagnik — SongBPM](https://songbpm.com/@sanjeev-chaturvedi/achyutam-keshavam-by-alka-yagnik---from-achyutam-keshavam-by-alka-yagnik---zee-music-devotional-ITofzWALPz)
- [Achutam Keshavam — Wikipedia](https://en.wikipedia.org/wiki/Achutam_Keshavam)
- [Achyutam Keshavam — Free Sargam Notations](https://notesandsargam.com/achyutam-keshavam/)
- [Achyutam Keshavam Sargam Notes — Sangeet Book](https://sangeetbook.com/achutam-keshavam-sargam-notes-in-hindi/)
- [Achyutam Keshavam — Notes for Flute, Harmonium, Keyboard — Notation Zone](http://notationzone.com/achyutam-keshavam-notes-for-flute-harmonium-keyboard/)
- [Achyutam Keshavam Krishna Damodaram — Harmonium notes in 12 keys — Synthesizer Notes](https://www.synthesizernotes.com/achyutam-keshavam-krishna-damodaram-harmonium.html)
