// The A/B test from 2026-09-29 that motivated the fit editor (see
// FIT_EDITOR_SPEC.md). Takes a transcription whose tune landed in V: Ins,
// moves it to V: Vocal (A), then merges adjacent notes inside each bar, the
// shortest pair first and keeping the first pitch, until every phrase has
// one note per syllable (B). Writes both as requests; render them with
// scripts/generate.sh. A reference, not the editor: it picks merges blindly
// (it dropped phrase 1's "b"), which is exactly what a person should decide.
// Run: node cloudflare/test/fit-ab-prototype.cjs
const fs = require('fs');
const path = require('path');
const M = require('../public/assets/melody-check.js');
const root = path.resolve(__dirname, '../..');
const swapped = M.swapVocalAndInstrument(fs.readFileSync(path.join(__dirname, 'fixtures/hummed-tune-in-ins-1ddc5f64.abc'), 'utf8'));
const lyricsLines = ['Om Krishnaaya Vaasudevaaya', 'Haraye Paramaatmane', 'Pranatah Klesha Naashaaya', 'Govindaaya Namo Namah'];
const targets = M.splitSyllables(lyricsLines.join('\n')).map(l => l.length);
const note = /([\^=_]*[A-Ga-gz][,']*)(\d*)/g;
const parseBar = bar => [...bar.matchAll(note)].map(m => ({ pitch: m[1], len: m[2] ? Number(m[2]) : 1 }));
const lines = swapped.split('\n');
let phrase = 0, inVerse = false, voice = null;
const out = lines.map(line => {
  if (line.startsWith('% ')) { inVerse = line === '% verse'; return line; }
  if (line.startsWith('V: ')) { voice = line.slice(3); return line; }
  if (!inVerse || voice !== 'Vocal' || /^Z/.test(line)) return line;
  if (phrase >= targets.length) return line.split('|').map(b => b.trim() ? 'Z' : b).join('|'); // tail: no words left
  const bars = line.split('|').filter(b => b.trim()).map(parseBar);
  let count = bars.reduce((n, b) => n + b.filter(x => x.pitch !== 'z').length, 0);
  const target = targets[phrase++];
  while (count > target) {
    let best = null;
    bars.forEach((bar, bi) => bar.forEach((x, i) => { const y = bar[i + 1]; if (y && x.pitch !== 'z' && y.pitch !== 'z' && (!best || x.len + y.len < best.sum)) best = { bi, i, sum: x.len + y.len }; }));
    if (!best) break;
    const bar = bars[best.bi]; bar[best.i].len = best.sum; bar.splice(best.i + 1, 1); count--;
  }
  console.error(`phrase ${phrase}: target ${target} syllables -> ${count} notes`);
  return bars.map(b => b.map(x => x.pitch + (x.len === 1 ? '' : x.len)).join('')).join('|') + '|';
});
const fitted = out.join('\n');
const base = JSON.parse(fs.readFileSync(path.join(root, 'requests/achyutam-mantra-v1.json')));
const make = (abc, label) => ({ ...base, abc, lyrics: '[Verse]\n' + lyricsLines.join('\n'), duration: 30, semantic_sampling: { min_tokens: 200, max_tokens: 750 }, _test: label });
fs.writeFileSync(path.join(root, 'requests/fit-test-A-as-transcribed.json'), JSON.stringify(make(swapped, 'A: transcribed tune, notes as-is (melisma)'), null, 2) + '\n');
fs.writeFileSync(path.join(root, 'requests/fit-test-B-fitted.json'), JSON.stringify(make(fitted, 'B: same tune, notes merged to 9/8/8/8 = one note per syllable'), null, 2) + '\n');
for (const [n, a] of [['A', swapped], ['B', fitted]]) { const s = M.analyzeScore(a); console.log(n, 'notes', s.notes, 'sung', s.sungSeconds.toFixed(1) + 's', 'bar-length', s.seconds.toFixed(1) + 's'); }
console.log('--- B verse:\n' + fitted.split('% verse')[1]);
