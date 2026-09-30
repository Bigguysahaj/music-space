// Unit tests for cloudflare/public/assets/fit-editor.js, on the real hummed
// tune from the 2026-09-29/30 listening tests.
// Run: node cloudflare/test/fit-editor.test.cjs
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const M = require('../public/assets/melody-check.js');
const F = require('../public/assets/fit-editor.js');

const root = path.resolve(__dirname, '../..');
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const lyrics = '[Verse]\nOm Krishnaaya Vaasudevaaya\nHaraye Paramaatmane\nPranatah Klesha Naashaaya\nGovindaaya Namo Namah';
const tune = M.swapVocalAndInstrument(fixture('hummed-tune-in-ins-1ddc5f64.abc'));
const model = F.parse(tune, lyrics);
const pitches = p => F.describe(p, model.header).notes.map(n => n.midi);
const counts = p => F.describe(p, model.header).groupCount;

// Phrases: the four verse lines with notes, plus the outro line that has no words.
assert.strictEqual(model.voice, 'Vocal');
assert.deepStrictEqual(model.phrases.map(p => p.target), [9, 8, 8, 8, null]);
assert.deepStrictEqual(model.phrases.map(p => p.section), ['verse', 'verse', 'verse', 'verse', 'verse']);
assert(model.phrases.every(p => p.editable));
assert.deepStrictEqual(model.phrases.map(p => F.describe(p, model.header).noteCount), [14, 14, 16, 14, 15]);
assert.strictEqual(F.toAbc(model), tune, 'nothing changed, nothing rewritten');

// Keys: F major has B flat; A minor has none; D major has F and C sharp.
assert.deepStrictEqual(F.keySignature('F'), { B: -1 });
assert.deepStrictEqual(F.keySignature('Am'), {});
assert.deepStrictEqual(F.keySignature('D'), { F: 1, C: 1 });
assert.strictEqual(F.describe(model.phrases[0], model.header).notes[2].midi, 82, 'b in F major is B flat (82)');

// Lengths are written canonically for L:.
const one = F.splitNote(F.parse('X:1\nM:4/4\nL:1/8\nK:C\nV: Vocal\nC3|', 'la la').phrases[0], 0);
assert.strictEqual(F.serializePhrase(one, {}), 'C3/2C3/2|');
assert.strictEqual(F.serializePhrase(F.splitNote(F.splitNote(F.parse('X:1\nL:1/8\nK:C\nV: Vocal\nC2|', 'a').phrases[0], 0), 0), {}), 'C/2C/2C|');

// Tying repeats reproduces the hand-written take E for phrases 1 to 3 and loses nothing.
const E = JSON.parse(fs.readFileSync(path.join(root, 'requests/fit-test-E-tie-only.json'))).abc;
const eLines = E.split('% verse')[1].split('\n').filter(l => /^[a-g]/.test(l));
model.phrases.slice(0, 3).forEach((p, i) => {
  const tied = F.tieRepeats(p);
  assert.strictEqual(F.serializePhrase(tied, model.sig), eLines[i], `phrase ${i + 1} ties like take E`);
  assert.deepStrictEqual(pitches(tied), pitches(p));
});
const tiedOnce = F.tieRepeats(model.phrases[0]);
assert.strictEqual(F.tieRepeats(tiedOnce), tiedOnce, 'tying again changes nothing');

// Auto-fit reaches exactly 9/8/8/8, keeps every pitch (phrase 1's b included), keeps every bar's length.
const fitted = model.phrases.map(p => (p.target ? F.autoFit(p, p.target) : p));
assert.deepStrictEqual(fitted.map(counts), [9, 8, 8, 8, 15]);
fitted.forEach((p, i) => assert.deepStrictEqual(pitches(p), pitches(model.phrases[i]), 'no pitch lost'));
assert(pitches(fitted[0]).includes(82), "phrase 1's b survives");
const out = F.toAbc(model, fitted);
assert.deepStrictEqual(F.barLengths(out), F.barLengths(tune), 'every bar keeps its length');
assert.deepStrictEqual(F.barLengths(out, /^ins/i), F.barLengths(tune, /^ins/i));
assert.strictEqual(out.split('K:')[0], tune.split('K:')[0], 'header unchanged');
const vocalLines = new Set(model.phrases.map(p => p.line));
assert.deepStrictEqual(out.split('\n').filter((l, i) => !vocalLines.has(i)), tune.split('\n').filter((l, i) => !vocalLines.has(i)), 'only the Vocal notes changed');
// Round trip: what analyzeScore reads back is one sung note per group.
const back = F.parse(out, lyrics);
assert.deepStrictEqual(back.phrases.map(p => counts(p)), [9, 8, 8, 8, 15]);
assert.strictEqual(M.analyzeScore(out).notes, 9 + 8 + 8 + 8 + 15 + 2, 'plus the two intro notes');
assert(Math.abs(M.analyzeScore(out).seconds - M.analyzeScore(tune).seconds) < 1e-9);
assert.strictEqual(F.toAbc(back), out, 'parsing and rewriting is stable');
assert.strictEqual(M.checkMelody({ abc: out, lyrics, duration: 30, cot: 'melody' }).issues.some(i => i.id === 'melisma' || i.id === 'short-score'), false);

// Links: a tie between different pitches is a slur; nothing links across a rest or off the end.
const p0 = model.phrases[0];
assert.strictEqual(F.describe(F.setLink(p0, 0, 'tie'), model.header).notes[0].link, 'tie', 'a then a');
assert.strictEqual(F.describe(F.setLink(p0, 2, 'tie'), model.header).notes[2].link, 'slur', 'b to a differs');
const restful = F.parse('X:1\nM:4/4\nL:1/8\nK:C\nV: Vocal\nC2 z2 D2 E2|', 'a b c').phrases[0];
assert.strictEqual(F.setLink(restful, 0, 'slur'), null, 'across a rest');
assert.notStrictEqual(F.setLink(restful, 1, 'slur'), null);
assert.strictEqual(F.setLink(p0, 13, 'slur'), null, 'past the end');

// Stretch: hold one more, one fewer.
const grown = F.stretch(p0, 0, +1);
assert.strictEqual(counts(grown), 13);
assert.strictEqual(counts(F.stretch(grown, 0, -1)), 14);
assert.strictEqual(F.stretch(p0, 0, -1), null);

// Slurs are written with parentheses and read back; ties with a dash, both inside one group.
const slurred = F.parse('X:1\nM:2/4\nL:1/16\nK:C\nV: Vocal\nC4D4|E4-E4F4|', 'a b c').phrases[0];
const joined = F.setLink(F.setLink(slurred, 0, 'slur'), 3, 'slur');
assert.strictEqual(F.serializePhrase(joined, {}), '(C4D4)|(E4-E4F4)|');
assert.strictEqual(counts(F.parse('X:1\nM:2/4\nL:1/16\nK:C\nV: Vocal\n(C4D4)|(E4-E4F4)|', 'a b c').phrases[0]), 2);
assert.strictEqual(M.analyzeScore('X:1\nM:2/4\nL:1/16\nK:C\nV: Vocal\n(C4D4)|(E4-E4F4)|').notes, 2);
assert.strictEqual(M.analyzeScore('X:1\nM:4/4\nL:1/4\nK:C\nV: Vocal\n(3ABc (de)f|').notes, 5, 'tuplets are not slurs');

// Merging into one held note: lossy, within a bar only, keeps the chosen pitch.
const bar1 = F.stretch(p0, 0, +1); // a a tied
const held = F.mergeToHeld(bar1, 0);
assert.strictEqual(counts(held), 13);
assert.strictEqual(F.describe(held, model.header).notes[0].len, 12);
assert.strictEqual(F.mergeBlocked(F.stretch(F.stretch(p0, 3, +1), 3, +1), 3), null, 'inside a bar');
let across = p0;
across = F.stretch(across, 2, +1); // b joined to the a that opens bar 2
assert.strictEqual(F.mergeBlocked(across, 2), 'barline');
assert.strictEqual(F.mergeToHeld(across, 2), null);
assert.strictEqual(F.mergeBlocked(p0, 0), 'single');
const keepHigh = F.mergeToHeld(F.stretch(p0, 1, +1), 1, 1); // a6 then g2f4e4: keep note 1
assert.strictEqual(pitches(keepHigh)[1], pitches(p0)[1]);

// Too few notes: releases joins, then splits the longest note; bars keep their length.
const few = F.parse('X:1\nM:4/4\nL:1/8\nQ:1/4=90\nK:C\nV: Vocal\nC4 E4|G8|', 'one two three four five');
const fewFit = F.autoFit(few.phrases[0], 5);
assert.strictEqual(counts(fewFit), 5);
assert.deepStrictEqual(F.barLengths(F.toAbc(few, [fewFit])), F.barLengths(few.abc));
const relink = F.autoFit(F.setLink(F.setLink(few.phrases[0], 0, 'slur'), 1, 'slur') || few.phrases[0], 3);
assert.strictEqual(counts(relink), 3);

// "Close enough" counts as fitting: 12 groups on 9 syllables is close, 14 is not.
assert.strictEqual(F.fitState(9, 9).state, 'fits');
assert.strictEqual(F.fitState(12, 9).state, 'close');
assert.strictEqual(F.fitState(14, 9).state, 'many');
assert.strictEqual(F.fitState(5, 9).state, 'few');
assert.strictEqual(F.fitState(10, null).state, 'none');
assert.strictEqual(F.fitState(counts(F.autoFit(p0, 9, { exact: false })), 9).state === 'close' || counts(F.autoFit(p0, 9, { exact: false })) === 9, true, 'stops once close enough');
assert(counts(F.autoFit(p0, 9, { exact: false })) >= 9);

// Words-less phrase to rests, bar by bar.
const rests = F.toRests(model.phrases[4]);
assert.strictEqual(F.serializePhrase(rests, model.sig), 'z16|z16|z16|z16|');
assert.deepStrictEqual(F.barLengths(F.toAbc(model, [rests]))[8], F.barLengths(tune)[8]);

// Things the editor does not understand stay read-only and untouched.
const chordy = F.parse('X:1\nM:4/4\nL:1/8\nK:C\nV: Vocal\n[CEG]4 D4|', 'a b');
assert.strictEqual(chordy.phrases[0].editable, false);
assert.strictEqual(F.autoFit(chordy.phrases[0], 2), chordy.phrases[0]);
assert.strictEqual(F.toAbc(chordy, [F.autoFit(chordy.phrases[0], 2)]), chordy.abc);
// Sections named intro/outro are skipped; a single voice with no V: field still parses.
assert.strictEqual(F.parse('X:1\nL:1/8\nM:4/4\nK:C\n% intro\nV: Vocal\nC8|\n% verse\nD8|', 'a').phrases.length, 1);
assert.strictEqual(F.parse('X:1\nL:1/8\nM:4/4\nK:C\nC4 D4|\nE8|', 'a b').phrases.length, 2);
// The hand score from the requests folder parses as two-line verses.
const hand = JSON.parse(fs.readFileSync(path.join(root, 'requests/achyutam-mantra-v1.json'))).abc;
const handModel = F.parse(hand, lyrics);
assert.deepStrictEqual(handModel.phrases.map(p => [p.lyricLine, p.target]), [[-2, 33]], 'a whole verse on one tune line is fitted against all its syllables');

// Listening: a tie is one longer tone, a slur is separate tones of one syllable.
const tones = F.schedule(F.stretch(F.stretch(p0, 0, +1), 1, +1), model.header);
assert.strictEqual(tones.events[0].notes.length, 2);
assert(Math.abs(tones.events.reduce((s, e) => Math.max(s, e.start + e.duration), 0) - F.describe(p0, model.header).length * (1 / 32 / (1 / 4)) * (60 / 86)) < 1e-9);

console.log('fit-editor: all tests pass');
