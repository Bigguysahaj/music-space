// Fit editor: the pure logic behind "fit the words to the notes". It reads
// the Vocal voice of an ABC score as phrases of notes, lets a person decide
// which notes each syllable holds, and writes the score back. No DOM, so it
// can be tested in Node.
//
// How a syllable holds several notes (listening test, 2026-09-30): a tie
// (same pitch) or a slur (different pitches) joins notes into one group, and
// the model sings one group on one syllable. Both keep every note, so the
// tune survives; merging notes into one held note (mergeToHeld) does not, and
// is the last resort. Every operation returns a new phrase and never changes
// a bar's length, so the score stays in time.
(function (root) {
  const MC = typeof require !== 'undefined' ? require('./melody-check.js') : root.MelodyCheck;
  const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const SHARP_ORDER = 'FCGDAEB', FLAT_ORDER = 'BEADGCF';
  const NON_LYRIC = /^(intro|outro|inst|interlude|solo|break)/i;
  const EPS = 1e-9;

  // ---- keys and pitches -------------------------------------------------

  function keySignature(key) {
    const m = /^\s*([A-G])([#b]?)\s*([A-Za-z]*)/.exec(key || '');
    const alter = {};
    if (!m) return alter;
    const fifths = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, F: -1 };
    const tonic = m[1], accidental = m[2], mode = m[3].toLowerCase();
    let sharps = fifths[tonic] + (accidental === '#' ? 7 : accidental === 'b' ? -7 : 0);
    if (/^(m|min|minor|aeo)/.test(mode) && !/^maj/.test(mode)) sharps -= 3;
    else if (/^dor/.test(mode)) sharps -= 2;
    else if (/^phr/.test(mode)) sharps -= 4;
    else if (/^lyd/.test(mode)) sharps += 1;
    else if (/^mix/.test(mode)) sharps -= 1;
    else if (/^loc/.test(mode)) sharps -= 5;
    for (let i = 0; i < Math.abs(sharps) && i < 7; i++) alter[(sharps > 0 ? SHARP_ORDER : FLAT_ORDER)[i]] = sharps > 0 ? 1 : -1;
    return alter;
  }

  const octaveOf = (letter, marks) => (letter === letter.toUpperCase() ? 4 : 5) + (marks.match(/'/g) || []).length - (marks.match(/,/g) || []).length;
  const naturalMidi = (letter, marks) => 12 * (octaveOf(letter, marks) + 1) + LETTER[letter.toUpperCase()];
  const accidentalAlter = acc => (acc === '=' ? 0 : acc.startsWith('^') ? acc.length : -acc.length);
  const accidentalText = alter => (alter === 0 ? '=' : alter > 0 ? '^'.repeat(alter) : '_'.repeat(-alter));

  function lengthText(len) {
    if (Math.abs(len - 1) < EPS) return '';
    for (const d of [1, 2, 4, 8, 16, 32, 64]) {
      const n = Math.round(len * d);
      if (n > 0 && Math.abs(len * d - n) < EPS) {
        const g = (a, b) => (b ? g(b, a % b) : a);
        const div = g(n, d), num = n / div, den = d / div;
        return den === 1 ? String(num) : num === 1 ? '/' + den : `${num}/${den}`;
      }
    }
    return String(len);
  }
  const readLength = (num, slashes, den) => {
    let v = num ? Number(num) : 1;
    if (slashes) v /= den ? Number(den) : 2 ** slashes.length;
    return v;
  };

  // ---- reading a line of Vocal music ------------------------------------

  // elems: note | rest | mrest (multi-bar rest) | bar | raw. Anything the
  // editor does not understand (chords, tuplets, grace notes, ...) leaves the
  // phrase read-only, with its line kept exactly as written.
  function readLine(text, header, sig) {
    const elems = [];
    let pos = 0, pre = '', prev = null, tie = false, slurDepth = 0, slurFirst = null, unsupported = null;
    let barAlter = {};
    const sticky = re => { re.lastIndex = pos; return re.exec(text); };
    const NOTE = /([\^=_]*)([A-Ga-g])([,']*)(\d*)(\/*)(\d*)/y, REST = /([zx])(\d*)(\/*)(\d*)/y, MREST = /([ZX])(\d*)/y;
    const BAR = /(?:\|\]|\|\||\[\||\|:|:\||::|\||:)/y, PRE = /"[^"]*"|![^!]*!|\+[^+]*\+|[.~HLMOPSTuv]/y;
    const OPEN = /\((?!\d)/y, CLOSE = /\)/y, TIE = /-/y, SPACE = /\s+/y;
    const flush = () => { if (pre) { elems.push({ t: 'raw', raw: pre }); pre = ''; } };
    while (pos < text.length && !unsupported) {
      let m;
      if ((m = sticky(SPACE))) { pos += m[0].length; continue; }
      if (text[pos] === '%') break;
      if ((m = sticky(PRE))) { pre += m[0]; pos += m[0].length; continue; }
      if ((m = sticky(OPEN))) { if (slurDepth === 0) slurFirst = null; slurDepth++; pos++; continue; }
      if ((m = sticky(CLOSE))) { slurDepth = Math.max(0, slurDepth - 1); if (!slurDepth) slurFirst = null; pos++; continue; }
      if ((m = sticky(TIE))) { if (!prev) unsupported = 'tie'; else tie = true; pos++; continue; }
      if ((m = sticky(MREST))) { flush(); elems.push({ t: 'mrest', ch: m[1], n: m[2] ? Number(m[2]) : 1 }); prev = null; tie = false; pos += m[0].length; continue; }
      if ((m = sticky(NOTE))) {
        const [whole, acc, letter, marks, num, slashes, den] = m;
        const base = naturalMidi(letter, marks), slot = letter.toUpperCase() + octaveOf(letter, marks);
        const alter = acc ? accidentalAlter(acc) : (slot in barAlter ? barAlter[slot] : (sig[letter.toUpperCase()] || 0));
        if (acc) barAlter[slot] = alter;
        const note = { t: 'note', letter, marks, midi: base + alter, len: readLength(num, slashes, den), link: 'none', pre };
        pre = '';
        if (prev) {
          if (tie) prev.link = prev.midi === note.midi ? 'tie' : 'slur';
          else if (slurDepth > 0 && slurFirst !== null) prev.link = 'slur';
        }
        if (slurDepth > 0 && slurFirst === null) slurFirst = note;
        elems.push(note);
        prev = note; tie = false; pos += whole.length;
        continue;
      }
      if ((m = sticky(REST))) { elems.push({ t: 'rest', ch: m[1], len: readLength(m[2], m[3], m[4]), pre }); pre = ''; prev = null; tie = false; pos += m[0].length; continue; }
      if ((m = sticky(BAR))) { flush(); elems.push({ t: 'bar', raw: m[0] }); barAlter = {}; pos += m[0].length; continue; }
      unsupported = text[pos];
    }
    flush();
    return { elems, unsupported };
  }

  // Syllables a phrase should have: one lyric line's, all lines' (-2), or none.
  function targetFor(lyricLines, lyricLine) {
    if (lyricLine === -2) return lyricLines.reduce((sum, l) => sum + l.length, 0) || null;
    return lyricLine >= 0 && lyricLines[lyricLine] ? lyricLines[lyricLine].length : null;
  }

  // ---- parsing a whole score --------------------------------------------

  function parse(abc, lyrics, opts = {}) {
    const text = String(abc || '');
    const score = MC.readScore(text);
    const lines = text.split('\n');
    const sig = keySignature(score.key);
    const voices = [...new Set(score.events.map(e => e.voice))];
    const voice = voices.find(v => /^vocal/i.test(v || '')) || (voices.length ? voices[0] : null);
    let section = null, inBody = false;
    const sections = new Map();
    lines.forEach((line, index) => {
      const t = line.trim();
      if (/^K:/.test(t)) inBody = true;
      else if (inBody && t.startsWith('%')) section = t.replace(/^%+\s*/, '');
      sections.set(index, section);
    });
    const phrases = [];
    for (const e of score.events) {
      if (e.voice !== voice) continue;
      const sec = sections.get(e.index);
      if (sec && NON_LYRIC.test(sec)) continue;
      const { elems, unsupported } = readLine(lines[e.index].replace(/%.*$/, ''), score, sig);
      if (!unsupported && !elems.some(x => x.t === 'note')) continue;
      phrases.push({ id: phrases.length, line: e.index, section: sec || null, elems, editable: !unsupported, reason: unsupported ? `Can't edit "${unsupported}" here` : null, raw: lines[e.index], dirty: false });
    }
    const lyricLines = MC.splitSyllables(lyrics);
    // One tune line for several lyric lines (a whole verse on one line of
    // music) is fitted against all the syllables together: lyricLine -2.
    const whole = phrases.length === 1 && lyricLines.length > 1;
    const assignment = phrases.map((p, i) => (opts.assign && opts.assign[i] !== undefined ? opts.assign[i] : whole ? -2 : i < lyricLines.length ? i : -1));
    phrases.forEach((p, i) => { p.lyricLine = assignment[i]; p.target = targetFor(lyricLines, assignment[i]); });
    return { abc: text, lines, header: { unit: score.unit, meter: score.meter, beat: score.beat, bpm: score.bpm, key: score.key }, sig, voice, phrases, lyricLines, assignment };
  }

  // ---- writing ----------------------------------------------------------

  function groupsOf(elems) {
    const notes = elems.filter(e => e.t === 'note');
    const groups = [];
    notes.forEach((n, i) => {
      if (i > 0 && notes[i - 1].link !== 'none') groups[groups.length - 1].push(i);
      else groups.push([i]);
    });
    return { notes, groups };
  }

  function serializePhrase(phrase, sig) {
    if (!phrase.dirty) return phrase.raw;
    const { notes, groups } = groupsOf(phrase.elems);
    const open = new Set(), close = new Set();
    for (const g of groups) if (g.length > 1 && g.slice(0, -1).some(i => notes[i].link === 'slur')) { open.add(notes[g[0]]); close.add(notes[g[g.length - 1]]); }
    let out = '', barAlter = {};
    for (const e of phrase.elems) {
      if (e.t === 'note') {
        const slot = e.letter.toUpperCase() + octaveOf(e.letter, e.marks);
        const alter = e.midi - naturalMidi(e.letter, e.marks);
        const implied = slot in barAlter ? barAlter[slot] : (sig[e.letter.toUpperCase()] || 0);
        let acc = '';
        if (alter !== implied) { acc = accidentalText(alter); barAlter[slot] = alter; }
        out += (open.has(e) ? '(' : '') + e.pre + acc + e.letter + e.marks + lengthText(e.len) + (close.has(e) ? ')' : '') + (e.link === 'tie' ? '-' : '');
      } else if (e.t === 'rest') out += e.pre + e.ch + lengthText(e.len);
      else if (e.t === 'mrest') out += e.ch + (e.n === 1 ? '' : e.n);
      else if (e.t === 'bar') { out += e.raw; barAlter = {}; }
      else out += e.raw;
    }
    return out;
  }

  function toAbc(model, phrases) {
    const lines = [...model.lines];
    for (const p of phrases || model.phrases) if (p.dirty) lines[p.line] = serializePhrase(p, model.sig);
    return lines.join('\n');
  }

  // ---- looking at a phrase ----------------------------------------------

  // Everything a view needs: notes with their group, position and bar, rests
  // and bar lines in order, and the syllable count the phrase asks for.
  function describe(phrase, header) {
    const barUnits = header ? header.meter / header.unit : null;
    const { notes, groups } = groupsOf(phrase.elems);
    const groupOf = [];
    groups.forEach((g, gi) => g.forEach(i => { groupOf[i] = gi; }));
    const items = [], bars = [0];
    let at = 0, ni = 0, bar = 0;
    for (const e of phrase.elems) {
      if (e.t === 'note') { items.push({ kind: 'note', index: ni, start: at, len: e.len, midi: e.midi, letter: e.letter, marks: e.marks, alter: e.midi - naturalMidi(e.letter, e.marks), link: e.link, group: groupOf[ni], bar }); ni++; at += e.len; bars[bar] += e.len; }
      else if (e.t === 'rest') { items.push({ kind: 'rest', start: at, len: e.len, bar }); at += e.len; bars[bar] += e.len; }
      else if (e.t === 'mrest') { const len = e.n * (barUnits || 0); items.push({ kind: 'rest', start: at, len, bar, bars: e.n }); at += len; bars[bar] += len; }
      else if (e.t === 'bar') { items.push({ kind: 'bar', start: at, bar }); bar++; bars[bar] = 0; }
    }
    return { items, notes: items.filter(i => i.kind === 'note'), groups, groupCount: groups.length, noteCount: notes.length, length: at, barLengths: bars.filter((l, i) => l > 0 || i < bar), target: phrase.target };
  }

  // "Close enough counts": a take asked for 46 notes on 33 syllables was
  // still clear, so a few extra or missing groups is reported as close.
  function fitState(groups, target) {
    if (!target) return { state: 'none', diff: 0 };
    const diff = groups - target;
    if (diff === 0) return { state: 'fits', diff };
    if (Math.abs(diff) <= Math.max(2, Math.ceil(target * 0.25))) return { state: 'close', diff };
    return { state: diff > 0 ? 'many' : 'few', diff };
  }

  // ---- editing ----------------------------------------------------------

  const clone = phrase => ({ ...phrase, elems: phrase.elems.map(e => ({ ...e })), dirty: true });
  const noteElems = phrase => phrase.elems.filter(e => e.t === 'note');
  // Indexes into phrase.elems of the i-th and (i+1)-th note, or null when a
  // rest sits between them (a link can't cross a rest).
  function adjacent(phrase, i) {
    const at = [];
    phrase.elems.forEach((e, k) => { if (e.t === 'note') at.push(k); });
    if (i < 0 || i + 1 >= at.length) return null;
    for (let k = at[i] + 1; k < at[i + 1]; k++) if (phrase.elems[k].t === 'rest' || phrase.elems[k].t === 'mrest') return null;
    return [at[i], at[i + 1]];
  }
  const barBetween = (phrase, a, b) => phrase.elems.slice(a + 1, b).some(e => e.t === 'bar');

  // kind: 'none' | 'tie' | 'slur'. A tie between different pitches becomes a
  // slur. Returns null when the two notes can't be joined.
  function setLink(phrase, i, kind) {
    if (!phrase.editable) return null;
    if (kind !== 'none' && !adjacent(phrase, i)) return null;
    const p = clone(phrase), notes = noteElems(p);
    if (!notes[i]) return null;
    notes[i].link = kind === 'tie' && notes[i].midi !== notes[i + 1].midi ? 'slur' : kind;
    return p;
  }

  // The core gesture: +1 lets a syllable hold one more following note, -1 one
  // fewer.
  function stretch(phrase, group, direction) {
    const { notes, groups } = groupsOf(phrase.elems);
    const g = groups[group];
    if (!g) return null;
    const last = g[g.length - 1];
    if (direction > 0) return group + 1 < groups.length ? setLink(phrase, last, notes[last].midi === notes[last + 1].midi ? 'tie' : 'slur') : null;
    return g.length > 1 ? setLink(phrase, last - 1, 'none') : null;
  }

  // Ties every pair of neighbouring notes of the same pitch inside a bar (the
  // way take E, the listening favourite, was written; `acrossBars` also ties
  // over bar lines). Loses nothing.
  function tieRepeats(phrase, opts = {}) {
    if (!phrase.editable) return null;
    const p = clone(phrase), notes = noteElems(p);
    let changed = false;
    notes.forEach((n, i) => {
      const at = i + 1 < notes.length && n.link === 'none' && n.midi === notes[i + 1].midi ? adjacent(p, i) : null;
      if (at && (opts.acrossBars || !barBetween(p, at[0], at[1]))) { n.link = 'tie'; changed = true; }
    });
    return changed ? p : phrase;
  }

  // Why a syllable's notes can't be merged into one held note, or null when
  // they can: a single held note can't cross a bar line or a rest.
  function mergeBlocked(phrase, group) {
    const { groups } = groupsOf(phrase.elems);
    const g = groups[group];
    if (!g) return 'missing';
    if (g.length < 2) return 'single';
    const at = [];
    phrase.elems.forEach((e, k) => { if (e.t === 'note') at.push(k); });
    return barBetween(phrase, at[g[0]], at[g[g.length - 1]]) ? 'barline' : null;
  }

  // The lossy last resort: one held note with the length of the whole group
  // and the pitch of note `keep` (an index into the phrase's notes).
  function mergeToHeld(phrase, group, keep) {
    if (mergeBlocked(phrase, group)) return null;
    const p = clone(phrase), { notes, groups } = groupsOf(p.elems), g = groups[group];
    const kept = keep === undefined ? g[0] : keep;
    if (!g.includes(kept)) return null;
    const first = notes[g[0]], last = notes[g[g.length - 1]];
    const held = { ...notes[kept], pre: first.pre, link: last.link, len: g.reduce((sum, i) => sum + notes[i].len, 0) };
    const drop = new Set(g.map(i => notes[i]));
    const at = p.elems.indexOf(first);
    p.elems = p.elems.filter(e => !drop.has(e));
    p.elems.splice(at, 0, held);
    return p;
  }

  // Makes room for one more syllable: the note becomes two of half length,
  // same pitch, and each holds its own syllable.
  function splitNote(phrase, i) {
    if (!phrase.editable) return null;
    const p = clone(phrase), notes = noteElems(p), n = notes[i];
    if (!n || n.len / 2 < 0.5 - EPS) return null;
    const second = { ...n, pre: '', len: n.len / 2 };
    n.len /= 2; n.link = 'none';
    p.elems.splice(p.elems.indexOf(n) + 1, 0, second);
    return p;
  }

  // Turns a phrase that has no words into rests, bar by bar.
  function toRests(phrase) {
    if (!phrase.editable) return null;
    const p = clone(phrase), out = [];
    let run = 0;
    const flush = () => { if (run > EPS) out.push({ t: 'rest', ch: 'z', len: run, pre: '' }); run = 0; };
    for (const e of p.elems) {
      if (e.t === 'note' || e.t === 'rest') run += e.len;
      else if (e.t === 'bar') { flush(); out.push(e); }
      else out.push(e);
    }
    flush();
    p.elems = out;
    return p;
  }

  // A suggestion for one phrase, never changing a bar's length or a pitch.
  // Too many notes: join neighbours, same-pitch ties first, then slurs that
  // prefer short notes, small steps, inside a bar and not the final note.
  // Too few: release joins, then split the longest note.
  function autoFit(phrase, target, opts = {}) {
    if (!phrase.editable || !target) return phrase;
    let p = phrase;
    for (let guard = 0; guard < 400; guard++) {
      const d = describe(p);
      const now = opts.exact === false ? fitState(d.groupCount, target).state : d.groupCount === target ? 'fits' : d.groupCount > target ? 'many' : 'few';
      if (now === 'fits' || now === 'close') break;
      let next = null;
      if (now === 'many') {
        const mean = d.notes.reduce((s, n) => s + n.len, 0) / Math.max(1, d.notes.length);
        let best = null;
        d.notes.forEach((n, i) => {
          const m = d.notes[i + 1];
          if (!m || n.link !== 'none' || !adjacent(p, i)) return;
          const size = d.groups[n.group].length + d.groups[m.group].length;
          let cost = (n.len + m.len) / (2 * mean) * 0.3;
          if (n.midi !== m.midi) cost += 1 + Math.abs(n.midi - m.midi) * 0.15 + (m.group === d.groups.length - 1 ? 0.5 : 0) + (n.bar !== m.bar ? 0.4 : 0) + Math.max(0, size - 3) * 0.5;
          if (!best || cost < best.cost) best = { i, cost };
        });
        if (best) next = setLink(p, best.i, d.notes[best.i].midi === d.notes[best.i + 1].midi ? 'tie' : 'slur');
      } else {
        const big = d.groups.map((g, gi) => ({ gi, size: g.length })).filter(x => x.size > 1).sort((a, b) => b.size - a.size)[0];
        if (big) {
          const g = d.groups[big.gi];
          let at = g[0], widest = -1;
          for (let k = 0; k < g.length - 1; k++) { const gap = Math.abs(d.notes[g[k]].midi - d.notes[g[k + 1]].midi) + (d.notes[g[k]].bar !== d.notes[g[k + 1]].bar ? 1 : 0); if (gap > widest) { widest = gap; at = g[k]; } }
          next = setLink(p, at, 'none');
        } else {
          let at = -1;
          d.notes.forEach((n, i) => { if (n.len / 2 >= 0.5 - EPS && (at < 0 || n.len > d.notes[at].len + EPS)) at = i; });
          if (at >= 0) next = splitNote(p, at);
        }
      }
      if (!next) break;
      p = next;
    }
    return p;
  }

  // ---- listening --------------------------------------------------------

  // Tones for a karaoke preview: a tie is one longer tone, a slur is
  // separate tones of one syllable. Seconds follow the score's L: and Q:.
  function schedule(phrase, header) {
    const secondsPerUnit = (header.unit / header.beat) * (60 / header.bpm);
    const d = describe(phrase, header), events = [];
    for (const n of d.notes) {
      const prev = events[events.length - 1];
      if (prev && n.index > 0 && d.notes[n.index - 1].link === 'tie') { prev.duration += n.len * secondsPerUnit; prev.notes.push(n.index); continue; }
      events.push({ start: n.start * secondsPerUnit, duration: n.len * secondsPerUnit, midi: n.midi, group: n.group, notes: [n.index] });
    }
    return { events, seconds: d.length * secondsPerUnit };
  }

  // Total length of every bar of each matching line, for tests that a rewrite
  // never changes the timing: one array of bar lengths per voice line.
  function barLengths(abc, voicePattern = /^vocal/i) {
    const model = MC.readScore(String(abc || ''));
    const barUnits = model.meter / model.unit, sig = keySignature(model.key);
    return model.events.filter(e => voicePattern.test(e.voice || '')).map(e => {
      const { elems } = readLine(e.line.replace(/%.*$/, ''), model, sig);
      const bars = [0];
      for (const el of elems) {
        if (el.t === 'note' || el.t === 'rest') bars[bars.length - 1] += el.len;
        else if (el.t === 'mrest') bars[bars.length - 1] += el.n * barUnits;
        else if (el.t === 'bar') bars.push(0);
      }
      return bars.filter((l, i) => l > 0 || i < bars.length - 1).map(l => Math.round(l * 1e6) / 1e6);
    });
  }

  const api = { parse, targetFor, describe, fitState, serializePhrase, toAbc, setLink, stretch, tieRepeats, mergeBlocked, mergeToHeld, splitNote, toRests, autoFit, schedule, barLengths, keySignature };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FitEditor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
