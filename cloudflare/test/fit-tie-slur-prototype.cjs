// Tie/slur A/B (FIT_EDITOR_SPEC.md §8.1). Same seed/style/length as take B
// (requests/fit-test-B-fitted.json); only the Vocal verse lines change.
//   C: the ORIGINAL tune kept, grouped into 9/8/8/8 syllables with ties and
//      slurs (nothing flattened, nothing dropped).
//   E: ties only (same-pitch merges), different pitches left as separate notes.
// Run: node cloudflare/test/fit-tie-slur-prototype.cjs   then render with scripts/generate.sh
const fs = require('fs');
const path = require('path');
const M = require('../public/assets/melody-check.js');
const root = path.resolve(__dirname, '../..');
const B = JSON.parse(fs.readFileSync(path.join(root, 'requests/fit-test-B-fitted.json'), 'utf8'));
const C = ['a6-a6b4|(a6g2)f4e4|g6-g6a4|(a2g6)(f4g4)|', 'a6-a6b4|(a6g2)(f4e4)|g6-g6a4|(a2g6)(f4e4)|',
  'e4d2-d6-d4|e4g2-g6-g4|(a4g2-g2)(f4e4)|f8-f4e4|', 'e4d2-d6d4|e4g2-g6-g4|(a4g2-g2)(f4e4)|f16|'];
const E = ['a6-a6b4|a6g2f4e4|g6-g6a4|a2g6f4g4|', 'a6-a6b4|a6g2f4e4|g6-g6a4|a2g6f4e4|',
  'e4d2-d6-d4|e4g2-g6-g4|a4g2-g2f4e4|f8-f4e4|', 'e4d2-d6d4|e4g2-g6-g4|a4g2-g2f4e4|f16|'];
function build(lines) {
  let i = 0, inVerse = false, voice = null;
  return B.abc.split('\n').map(l => {
    if (l.startsWith('% ')) { inVerse = l === '% verse'; return l; }
    if (l.startsWith('V: ')) { voice = l.slice(3); return l; }
    if (inVerse && voice === 'Vocal' && !/^Z/.test(l) && i < 4) return lines[i++];
    return l;
  }).join('\n');
}
const cfg = { C: [C, 'C: original tune kept; ties+slurs group it into 9/8/8/8 syllables'], E: [E, 'E: ties only (same pitch); different pitches left separate'] };
for (const [k, [lines, label]] of Object.entries(cfg)) {
  const abc = build(lines);
  fs.writeFileSync(path.join(root, `requests/fit-test-${k}-${k === 'C' ? 'tie-slur' : 'tie-only'}.json`), JSON.stringify({ ...B, abc, _test: label }, null, 2) + '\n');
  const s = M.analyzeScore(abc);
  console.log(k, 'notes', s.notes, 'bar-length', s.seconds.toFixed(1) + 's');
}
