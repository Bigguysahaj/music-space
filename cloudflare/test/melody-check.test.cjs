// Unit tests for cloudflare/public/assets/melody-check.js, on real scores.
// Run: node cloudflare/test/melody-check.test.cjs
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const M = require('../public/assets/melody-check.js');

const root = path.resolve(__dirname, '../..');
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const mantra = '[Verse]\nOm Krishnaaya Vaasudevaaya\nHaraye Paramaatmane\nPranatah Klesha Naashaaya\nGovindaaya Namo Namah';

// Syllables: Romanized vowel groups with "y" as a consonant; Devanagari aksharas.
assert.deepStrictEqual(M.splitSyllables(mantra).map(line => line.length), [9, 8, 8, 8]);
assert.strictEqual(M.splitSyllables('ॐ कृष्णाय वासुदेवाय').flat().length, 1 + 3 + 5);

// A generated 16.5 s take transcribed back: 7 bars of 4/4 at 92 BPM, sung part inside the clip.
const take = M.analyzeScore(fixture('generated-take-16s.abc'));
assert(take.sungSeconds <= 16.6 && take.sungSeconds > 14);
assert(Math.abs(take.seconds - 7 * 4 * 60 / 92) < 1e-9);

// Hand score: L:1/8, Q:1/4=93, 72 eighths = 36 beats. Line 2 is one note short of its 8 syllables.
const hand = JSON.parse(fs.readFileSync(path.join(root, 'requests/achyutam-mantra-v1.json'))).abc;
const h = M.analyzeScore(hand);
assert.strictEqual(h.notes, 32);
assert(Math.abs(h.seconds - 36 * 60 / 93) < 0.01);

// Ties, rests, chords, tuplets, fractional lengths.
const s = M.analyzeScore('X:1\nM:4/4\nL:1/4\nQ:1/4=60\nK:C\nV: Vocal\nz2 C-C | [CEG]2 (3ABc | D/2E/ F3/2 z/2 |');
assert.strictEqual(s.notes, 8);
assert(Math.abs(s.seconds - 11) < 1e-9);
assert.strictEqual(s.onsetSeconds, 2);

// Checks.
const ids = input => M.checkMelody({ lyrics: mantra, duration: 20, cot: 'melody', ...input }).issues.map(issue => issue.id);
assert.deepStrictEqual(ids({ abc: hand }), ['cut-off']);
assert(M.checkMelody({ abc: hand, lyrics: mantra, duration: 20, cot: 'melody' }).issues[0].recommended === 26);
assert.deepStrictEqual(ids({ abc: hand, duration: 26, cot: 'full' }), []);
assert.deepStrictEqual(ids({ abc: hand, duration: 26, cot: 'off' }), ['ignored']);
assert.deepStrictEqual(ids({ abc: '' }), []);
const fragment = 'X:1\nM:4/4\nL:1/16\nQ:1/4=92\nK:D\nV: Vocal\nD4E2E2F2E2E2D2|D2=C2D2D2D4E2D2|';
assert.deepStrictEqual(ids({ abc: fragment }), ['short-score'], 'no "shorten Length" tip when the score is too short anyway');

// Intro trim keeps voices aligned, and refuses when another voice plays there.
const intro = 'X:1\nM:4/4\nL:1/8\nQ:1/4=90\nK:C\nV: Vocal\nz8|z8|C2D2E2F2|G8|\nV: Ins\nZ4|';
const trimmed = M.trimLeadingRests(intro);
assert.strictEqual(trimmed.bars, 2);
assert(trimmed.abc.includes('\nC2D2E2F2|G8|') && trimmed.abc.includes('\nZ2|'));
assert.strictEqual(M.trimLeadingRests('X:1\nK:C\nV: Vocal\nz8|C8|\nV: Ins\nC8|D8|'), null);

// Hummed clips: the tune filed under V: Ins gets a swap; rests everywhere does not.
const inIns = fixture('hummed-7-notes-in-ins-00ba03db.abc');
assert.deepStrictEqual(ids({ abc: inIns }), ['tune-in-ins']);
const swapped = M.swapVocalAndInstrument(inIns);
assert.strictEqual(M.analyzeScore(swapped).notes, M.analyzeScore(inIns, /^ins/i).notes);
assert.strictEqual(M.analyzeScore(swapped, /^ins/i).notes, 0);
assert.strictEqual(M.analyzeScore(swapped).seconds, M.analyzeScore(inIns).seconds, 'bars unchanged');
assert.strictEqual(swapped.split('K:')[0], inIns.split('K:')[0], 'header unchanged');
assert.deepStrictEqual(ids({ abc: fixture('hummed-rests-only-2e7f0bff.abc') }), ['no-notes']);
assert.strictEqual(M.swapVocalAndInstrument('X:1\nK:C\nV: Vocal\nC8|'), null);

// The A/B fit test source: 75 notes for 33 syllables once swapped.
assert.strictEqual(M.analyzeScore(M.swapVocalAndInstrument(fixture('hummed-tune-in-ins-1ddc5f64.abc'))).notes, 75);

console.log('melody-check: all tests pass');
