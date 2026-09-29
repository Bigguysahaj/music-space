# Feature spec: drag-to-fit editor (fit the words to the notes)

**Priority: urgent — the next thing to build.** Handoff for an agent with
repo access to `/home/bigguysahaj/github/music-space` (Raagspace: a phone
page on Cloudflare that queues jobs for a laptop running YuE2 via
`yue2.cpp`). Read all of it before designing; §3 are hard facts about the
engine that the design must respect, and §8 are questions you are expected
to think through yourself rather than take from this doc.

## 1. The problem, in the user's words and ours

A score (typed, drafted, or transcribed from a hum/recording) rarely has one
note per syllable of the lyrics. When it has too few notes, words get
dropped; when it has too many, syllables smear across runs of notes. The
"Melody check" cards already *explain* this with an animation of syllables
dropping onto notes (screenshot the user liked: the "More notes than
syllables" card, 75 notes for 33 syllables). The user asked:

> is there a way to fix this visually by dragging and fitting UI, like the
> way you have shown in the animation

Build that: an editor where the person sees each lyric line's syllables
above that line's notes and **drags to decide which notes each syllable
gets**, and the score is rewritten to match.

## 2. Evidence that it works (2026-09-29)

Same seed (46), style, voice and Length (30 s); only the note/syllable fit
differs. Source: a real hummed transcription whose tune the transcriber
filed under `V: Ins` (`cloudflare/test/fixtures/hummed-tune-in-ins-1ddc5f64.abc`).

| Take | Score | Notes sung (output transcribed back) | Listener |
|---|---|---|---|
| A `outputs/krishna-20260929-173116-65638.wav` | tune moved to Vocal as-is: 75 notes / 33 syllables | 77 | — |
| B `outputs/krishna-20260929-173157-65661.wav` | same tune, notes merged per phrase to 9/8/8/8 | 45 | **"b is clear word for word"** (user) |

Requests: `requests/fit-test-A-as-transcribed.json`,
`requests/fit-test-B-fitted.json`. Reproduce B exactly with
`node cloudflare/test/fit-ab-prototype.cjs` (it rewrites both requests;
B comes out byte-identical). B's merge rule was blind — "shortest adjacent
pair in a bar, keep the first pitch" — and it **lost phrase 1's `b`**, i.e.
it flattened the melody. The editor exists so a person makes those choices
and keeps the tune.

## 3. Engine facts the design must respect

- **There is no syllable-to-note input.** Lyrics and score only meet by
  *section*: `% verse` in the ABC pairs with `[Verse]` in the lyrics. Inside
  a section the model places syllables itself. No `w:` lyric lines in any
  official example; don't generate them.
- **The model was trained on one syllable per note.** Official example
  `vendor/yue2.cpp/tools/webui/example/cover-happy-birthday-heavy-metal.json`:
  "HAP-PY BIRTH-DAY TO YOU" (6 syllables) sits on exactly 6 notes. So the
  editor's *output* is a score whose note count per phrase equals the
  syllable count, and "a syllable holds several notes" can only be expressed
  by **rewriting those notes into one held note** (or possibly a tie/slur —
  unverified, see §8).
- **The model follows the note layout closely but not exactly** (75→77,
  35→45 in the table). Treat "1:1" as the goal, not a guarantee.
- **The score is the single source of truth**: `#abc-score` (a textarea) in
  `cloudflare/public/index.html`. It is sent as `abc` on the generate
  request. The editor is a *view and editor of that text*, not a second
  store.
- Rhythmic/spoken mode (`cot: off`) ignores the score entirely; Length is a
  hard stop at `duration × 25` frames. Both already have Melody check cards.
- Pronunciation of Sanskrit/Hindi is a separate known problem
  (`PROJECT_STATUS.md`); the editor can't fix it and shouldn't claim to.

## 4. What already exists — reuse, don't rebuild

- `cloudflare/public/assets/melody-check.js` — pure functions (no DOM),
  loaded by the page as `window.MelodyCheck`, `require`-able in Node:
  - `splitSyllables(lyrics)` → array of lines, each an array of syllable
    strings (Romanized vowel groups with `y` as a consonant; Devanagari
    aksharas; skips `[Verse]` tags). This is the syllable source.
  - `analyzeScore(abc, voicePattern = /^vocal/i)` → `{notes, seconds,
    sungSeconds, onsetSeconds, bpm, voice}`. Its tokenizer (notes with
    accidentals/octaves/lengths, rests, multi-bar `Z`, chords `[CEG]`,
    tuplets, ties `-` counted as one note, inline fields, chord symbols) is
    the parsing reference — extract/share it rather than writing a second
    parser.
  - `checkMelody({abc, lyrics, duration, cot})` → issues; `trimLeadingRests`,
    `swapVocalAndInstrument` — examples of *safe score rewrites* (they
    preserve the header and every voice's bar count; follow that bar).
- Melody check UI in `index.html`: `renderMelodyCheck`, `CHECK_TEXT` (card
  copy: title / effect / todo / fix / why), `applyMelodyFix`,
  `syllableFlow` (the chip animation the user liked), `timeline`. Styles and
  keyframes at the end of `cloudflare/public/assets/garden.css` (`.check-card`,
  `.chip`, `.chip.spill`, `.chip.hum`, `.timeline`, `@keyframes chip-land`
  etc.). Reduced motion is already handled globally in that file.
- The score section is `#score-details`, nested **inside** `#sound-options`
  ("More sound options"). Anything that scrolls to it must open every
  enclosing `<details>` (see the `#check-summary` click handler).
- Transcribe flow (upload / mic → 24 kHz WAV in the browser → laptop
  SheetSage2 → ABC into `#abc-score`) and "Draft a melody" both end by
  filling `#abc-score` and calling `updatePreview()`.
- Test tooling in `cloudflare/test/` (all dependency-free, Node 22):
  - `melody-check.test.cjs` — unit tests on real fixtures.
  - `worker-harness.mjs` — the real Worker + `public/` on
    `http://127.0.0.1:8799`, D1→`node:sqlite`, KV→Map; password `userpw`.
  - `browser.mjs` — tiny DevTools-protocol driver (open, login, set, run,
    shot). Chromium is cached at
    `~/.cache/ms-playwright/chromium-1140/chrome-linux/chrome`.
  - `smoke-melody-check.mjs` — example scenario using both.
  - `fit-ab-prototype.cjs` — the blind merge from §2.
  - `fixtures/` — real transcriptions (a generated take; hums with the tune
    in `V: Ins`; a rests-only hum).

## 5. What to build — the experience

Design for a phone first (390 px wide, thumb, one hand), then desktop. The
user responded strongly to the *visual explanation*; the editor should feel
like that animation became something you can touch.

### 5.1 Getting there
- The "More notes than syllables" and "Not enough notes for your words"
  cards gain a primary button: **Fit words to notes**. It opens the editor
  in place, right under the score box (not a modal that hides the score).
- When a score and lyrics are both present and fit already, a quiet
  secondary link ("Adjust how the words sit on the notes") still opens it.

### 5.2 Layout: one lane per lyric line
- Each lyric line is a **lane**. Top: that line's syllable chips (same look
  as the existing `.chip`). Bottom: that phrase's notes as blocks — width ∝
  duration, vertical offset ∝ pitch (a mini piano roll, 5–7 px per
  semitone, clamped) — so the tune's shape is visible and a person can see
  what a merge would flatten.
- Thin connectors show which note(s) each syllable owns. A syllable owning
  several notes shows as one chip spanning them (a bracket underneath).
- Lane header: "Line 2 · 8 syllables · 14 notes", turning into
  "✓ 8 syllables · 8 notes" with the existing green `check-ok` look when it
  fits. Rests are gaps and can't own syllables.
- Phrases beyond the last lyric line (a transcribed outro) get a muted lane
  "No words here" with a choice: *keep as humming* or *turn into rests*
  (B turned its tail into rests).
- Long phrases scroll horizontally *inside the lane*; the page itself must
  never scroll sideways.

### 5.3 Interactions
- **Stretch a syllable** (the core gesture): drag the right edge handle of a
  syllable across the following notes. Released → those notes become the
  syllable's; on Apply they are written as one held note. Animate the notes
  sliding together, like `chip-land`.
- **Choose the pitch that stays**: a merged block defaults to its first
  note's pitch; tap it to cycle through the pitches it swallowed (or
  long-press for a small picker). Make it obvious this is how you keep the
  melody's high point — the thing the blind merge got wrong.
- **Split / make room** (too few notes): drag a syllable onto an occupied
  note, or tap a note's ✂, to split it into two notes of half length, same
  pitch. The spare half takes the next syllable.
- **Auto-fit** per lane and "Fit all": a suggestion the user previews before
  accepting. Do better than the prototype — you decide how (e.g. merge
  repeated pitches first, protect local peaks/valleys and phrase-final
  notes, prefer merging short ornamental notes into their neighbour).
- **Listen**: a play button per lane (and "play all") that plays the lane's
  melody with a simple Web Audio tone at the score's `Q:` tempo and
  highlights each syllable as its note sounds — a karaoke preview of how the
  model will be asked to sing it. This is the teaching loop: hear the fit
  before spending a GPU take.
- Undo / redo, and **Reset to original** (the score as it was when the
  editor opened).
- **Apply** writes the ABC back into `#abc-score`, calls `updatePreview()`,
  and the Melody check should then show its green "✓ Fits" card. Editing
  the textarea by hand while the editor is open re-parses the editor.
- Accessibility: every drag has a non-drag equivalent (select a syllable,
  then buttons/keys "hold one more note" / "one fewer note" / split);
  targets ≥ 44 px; screen-reader text per lane ("Line 1: 9 syllables on 9
  notes"); respects reduced motion.

### 5.4 Teaching moments (short, skippable)
- First open: a one-time coach mark (remember dismissal per device with
  `localStorage`, wrapped in try/catch) — "Each syllable needs one note.
  Drag a syllable's edge to let it hold several notes." with a 2-second
  looping demo of one chip stretching.
- Keep the card style: one line of effect, a "Why?" fold. Suggested why:
  "The model was trained on songs with one syllable per note, so it sings
  most clearly when the score gives each syllable exactly one."

## 6. Score rewriting rules (correctness bar)

- Only the Vocal voice's notes change. Header lines, `V:` declarations,
  `% section` comments, the Ins voice, chord symbols and bar lines are
  preserved.
- **Every bar keeps its total length** (assert it in tests, per voice). A
  merge sums durations; a split halves one.
- Merging across a barline is where it gets hard (a note can't span `|`).
  Options: tie (`a4-|a4`), or restrict merges to within a bar and let the
  UI explain why a handle stops at a barline. Decide after testing §8.1.
- Length suffixes must be written canonically for the score's `L:` (e.g.
  `a6`, `a10`, `a/2`), matching what `analyzeScore` reads back — round-trip
  every rewrite through `analyzeScore` in tests.
- Phrase ↔ lyric-line mapping: default to Vocal music lines inside the
  `% verse`/section blocks, in order, matched to non-empty lyric lines in
  order (this is what the prototype does). If the counts don't match, show
  it and let the person reassign — don't guess silently.

## 7. Engineering constraints

- No build step: `cloudflare/public/index.html` is one static page plus
  `/assets/*`. Put the logic in a new pure module (e.g.
  `assets/fit-editor.js`, same UMD pattern as `melody-check.js`) so it can
  be unit-tested in Node, and keep DOM code small and in the page (or a
  second asset). No external libraries needed; if you want one, it must
  load from cdnjs/jsdelivr/unpkg and justify itself.
- Match the page's look: cream/green palette and tokens in `garden.css`,
  system-ui text, Georgia headings, the existing card and chip styles.
- Pointer Events for drag (touch + mouse), `touch-action` set so lane drags
  don't scroll the page.
- The phone is the primary device; test at 390 px and 1280 px.

## 8. Questions to think through (decide, test, and document your answers)

1. **Ties and slurs.** Does the model sing `a4-a4` (tie) or `(ab)` (slur)
   as one syllable? If yes, a syllable can own several *different* pitches
   without flattening the tune — a much better merge. Run a same-seed A/B
   like §2 before building on either; B's clarity is the bar.
2. **How exact must the fit be?** B asked for 35 notes and came back with
   45 but was still "clear word for word". Is ±1 per line fine? Would the
   UI be friendlier if "close enough" also counts as fitting?
3. **Intentional melisma.** Bhajans hold vowels ("Govin-daaa-ya"). Should
   the editor let a person mark "hold this syllable over these notes on
   purpose" in a way the model respects, or is merging always the answer?
4. **Sections.** Should the editor also align section tags (`[Verse]` ↔
   `% verse`, add `[Chorus]` for repeated lines), since that is the only
   alignment channel the engine really has?
5. **Syllable edits.** The Romanized syllable splitter is a heuristic
   ("Kri·shnaa·ya"). Should people be able to split/join syllable chips
   (e.g. "Om" held long vs "O·m")? That changes the target count.
6. **Where the editor lives.** In-place under the score (recommended here)
   vs a full-screen sheet on phones. Try both on a real phone width before
   committing.
7. **Anything better.** If you find a clearer interaction than
   drag-the-edge after trying it (e.g. tap-to-assign, or dragging notes
   onto syllables), make the case and build that instead — the goal is the
   B result with the tune kept, reached easily on a phone.

## 9. Acceptance criteria

1. Unit tests (Node, `cloudflare/test/`): merge/split/auto-fit keep every
   bar's length and the header; round-trip through `analyzeScore`; the
   §2 fixture can be fitted to 9/8/8/8 with phrase 1's `b` kept.
2. Browser tests via `worker-harness.mjs` + `browser.mjs`: open editor from
   the card, stretch a syllable, apply, and the Melody check shows
   "✓ Fits"; no page errors; screenshots at 390 px and 1280 px look right.
3. **Listening bar (the real one):** fit the §2 fixture by hand in the
   editor keeping the tune's shape, render it with B's settings (seed 46,
   30 s, same style), and the user judges it at least as clear as B and
   closer to the hummed tune. That's a human check; set it up, don't claim
   it.
4. The existing melody-check tests still pass
   (`node cloudflare/test/melody-check.test.cjs`).

## 10. Running, testing, deploying

```bash
node cloudflare/test/melody-check.test.cjs            # unit tests
node cloudflare/test/worker-harness.mjs &             # local worker + page on :8799
~/.cache/ms-playwright/chromium-1140/chrome-linux/chrome --headless=new --no-sandbox \
  --disable-gpu --hide-scrollbars --remote-debugging-port=9333 \
  --user-data-dir=<scratch dir> about:blank &
node cloudflare/test/smoke-melody-check.mjs <screenshot dir>
node cloudflare/test/fit-ab-prototype.cjs             # regenerate the A/B requests
bash scripts/generate.sh requests/fit-test-B-fitted.json   # render on the laptop GPU (~40 s)
bash scripts/transcribe.sh outputs/<take>.wav true <out.abc>  # transcribe a take back
```

Deploy (frontend-only changes don't need the bridge restarted):

```bash
cd cloudflare
WRANGLER_SEND_METRICS=false node ~/.npm/_npx/32026684e21afda6/node_modules/wrangler/bin/wrangler.js deploy < /dev/null
```

Notes from this session: `npx wrangler` hangs on a registry check here, so
call the cached copy directly; wrangler also hangs *after* finishing while
sending telemetry unless `WRANGLER_SEND_METRICS=false`; `fetch failed` on
the first API call has been transient — retry. Deploying changes the live
app the user tests on their phone; confirm with the user first.
