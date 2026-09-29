// Melody check: reads an ABC score and the lyrics and explains, before a
// take is spent, the ways they will not fit together. Pure functions, no
// DOM, so they can be tested in Node. Warnings only: nothing here blocks a
// request.
(function (root) {
  const LYRIC_TAG = /^\s*\[[^\]]*\]\s*$/;

  // Romanized text: one syllable per vowel group (so "aa", "ai", "au" count
  // once), trailing consonants attached to the last syllable. Devanagari: one
  // syllable per consonant or independent vowel not followed by a virama.
  // Both are estimates; the check reports them as "about".
  function splitWord(word) {
    if (/[ऀ-ॿ]/.test(word)) {
      const parts = [];
      for (const ch of word) {
        const code = ch.codePointAt(0);
        const starts = (code >= 0x0904 && code <= 0x0939) || (code >= 0x0958 && code <= 0x0961) || code === 0x0950;
        if (starts && !(parts.length && parts[parts.length - 1].endsWith('्'))) parts.push(ch);
        else if (parts.length) parts[parts.length - 1] += ch;
      }
      return parts;
    }
    // "y" is a consonant in Romanized Sanskrit ("Krish-naa-ya"); only a
    // word with no other vowel ("my", "sky") uses it as one.
    const parts = /[aeiou]/i.test(word) ? word.match(/[^aeiouAEIOU]*[aeiouAEIOU]+/g) : word.match(/[^yY]*[yY]+/g);
    if (!parts) return word ? [word] : [];
    const tail = word.slice(parts.join('').length);
    parts[parts.length - 1] += tail;
    return parts;
  }

  function splitSyllables(lyrics) {
    const lines = [];
    for (const line of String(lyrics || '').split('\n')) {
      if (!line.trim() || LYRIC_TAG.test(line)) continue;
      const words = line.replace(/\([^)]*\)/g, ' ').split(/[\s\-–—]+/).map(w => w.replace(/[^\p{L}\p{M}']/gu, '')).filter(Boolean);
      const syllables = words.flatMap(splitWord);
      if (syllables.length) lines.push(syllables);
    }
    return lines;
  }

  function fraction(text, fallback) {
    const match = /^\s*(\d+)\s*\/\s*(\d+)/.exec(text || '');
    return match ? Number(match[1]) / Number(match[2]) : fallback;
  }

  // The length suffix of a note or rest: "3", "/", "//", "3/2", "/4".
  function lengthOf(num, slashes, den) {
    let value = num ? Number(num) : 1;
    if (slashes) value /= den ? Number(den) : 2 ** slashes.length;
    return value;
  }

  function innerLength(chord) {
    const first = /[A-Ga-g][,']*(\d*)(\/*)(\d*)/.exec(chord);
    return first ? lengthOf(first[1], first[2], first[3]) : 1;
  }

  // Walks the Vocal voice (or the first voice when none is named Vocal) and
  // returns its sung notes, total length and when the first note starts.
  // `voicePattern` picks another voice to measure, e.g. /^ins/i.
  function analyzeScore(abc, voicePattern = /^vocal/i) {
    const text = String(abc || '');
    if (!text.trim()) return null;
    let unit = null, meter = 1, beat = 0.25, bpm = 120, voice = null, firstVoice = null, inBody = false;
    const events = [];
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('%')) continue;
      const field = /^([A-Za-z]):\s*(.*)$/.exec(trimmed);
      if (field) {
        const [, key, value] = field;
        if (key === 'M') meter = /^C\|?$/.test(value.trim()) ? 1 : fraction(value, 1);
        else if (key === 'L') unit = fraction(value, null);
        else if (key === 'Q') {
          const tempo = /(?:(\d+\s*\/\s*\d+)\s*=\s*)?(\d+)/.exec(value);
          if (tempo) { if (tempo[1]) beat = fraction(tempo[1], 0.25); else beat = null; bpm = Number(tempo[2]); }
        } else if (key === 'K') inBody = true;
        else if (key === 'V') {
          voice = value.trim().split(/\s+/)[0];
          if (inBody && !firstVoice) firstVoice = voice;
        }
        continue;
      }
      if (!inBody) continue;
      events.push({ voice, line: trimmed });
    }
    if (unit === null) unit = meter >= 0.75 ? 1 / 8 : 1 / 16;
    if (beat === null) beat = unit;
    const match = events.find(e => voicePattern.test(e.voice || ''));
    const target = match ? match.voice : (voicePattern.source === '^vocal' ? firstVoice || null : undefined);
    const barUnits = meter / unit;
    const token = /"[^"]*"|![^!]*!|\[[A-Za-z]:[^\]]*\]|\((\d)|\[([^\]]*)\](\d*)(\/*)(\d*)|([\^=_]*)([A-Ga-g])([,']*)(\d*)(\/*)(\d*)|([zx])(\d*)(\/*)(\d*)|([ZX])(\d*)|(-)/g;
    let units = 0, notes = 0, onset = null, lastEnd = 0, tied = false, tuplet = 0, tupletScale = 1;
    for (const event of events) {
      if (event.voice !== target) continue;
      for (const m of event.line.replace(/%.*$/, '').matchAll(token)) {
        const scale = () => { if (tuplet > 0) { tuplet--; return tupletScale; } return 1; };
        if (m[1]) { const p = Number(m[1]); tuplet = p; tupletScale = p === 2 ? 3 / 2 : p === 3 ? 2 / 3 : (p === 4 ? 3 / 4 : 2 / p); }
        else if (m[2] !== undefined || m[7]) {
          // A chord [CEG]2 lasts as long as its first note times its suffix.
          const length = m[2] !== undefined ? innerLength(m[2]) * lengthOf(m[3], m[4], m[5]) : lengthOf(m[9], m[10], m[11]);
          if (onset === null) onset = units;
          if (!tied) notes++;
          tied = false;
          units += length * scale();
          lastEnd = units;
        } else if (m[12]) { units += lengthOf(m[13], m[14], m[15]) * scale(); tied = false; }
        else if (m[16]) { units += (m[17] ? Number(m[17]) : 1) * barUnits; tied = false; }
        else if (m[18]) tied = true;
      }
    }
    const secondsPerUnit = (unit / beat) * (60 / bpm);
    return {
      notes,
      seconds: units * secondsPerUnit,
      onsetSeconds: onset === null ? null : onset * secondsPerUnit,
      sungSeconds: lastEnd * secondsPerUnit,
      bpm,
      voice: target,
    };
  }

  // Issues in the order a person should fix them. Each is a plain object the
  // page renders; `fix` names a one-tap action the page knows how to apply.
  function checkMelody({ abc, lyrics, duration, cot }) {
    const issues = [];
    const score = analyzeScore(abc);
    if (!score) return { score: null, syllables: splitSyllables(lyrics), issues };
    const syllableLines = splitSyllables(lyrics);
    const syllableCount = syllableLines.reduce((sum, line) => sum + line.length, 0);
    if (cot === 'off') {
      issues.push({ id: 'ignored', level: 'warn', fix: 'balanced' });
      return { score, syllables: syllableLines, issues };
    }
    if (score.notes === 0) {
      // The transcriber sometimes files a hummed tune as an instrument line.
      const instrument = analyzeScore(abc, /^ins/i);
      if (instrument && instrument.notes > 0 && swapVocalAndInstrument(abc)) issues.push({ id: 'tune-in-ins', level: 'warn', notes: instrument.notes, fix: 'swap' });
      else issues.push({ id: 'no-notes', level: 'warn' });
    }
    else if (syllableCount && score.notes < syllableCount * 0.9) issues.push({ id: 'short-score', level: 'warn', notes: score.notes, syllables: syllableCount });
    else if (syllableCount && score.notes > syllableCount * 1.6) issues.push({ id: 'melisma', level: 'info', notes: score.notes, syllables: syllableCount });
    // Timing is about sung notes; with none there is nothing to time.
    if (score.notes === 0) return { score, syllables: syllableLines, issues };
    // Trailing rests (a transcription pads to whole bars) don't need Length.
    const recommended = Math.min(120, Math.max(5, Math.ceil(score.sungSeconds + 2)));
    if (Number.isFinite(duration) && duration < score.sungSeconds - 0.5) issues.push({ id: 'cut-off', level: 'warn', scoreSeconds: score.sungSeconds, duration, recommended, fix: 'length' });
    // A too-short score is the real problem there; shrinking Length to fit it
    // would only cut the words further, so that tip is left out.
    else if (Number.isFinite(duration) && duration > score.sungSeconds + 12 && !issues.some(i => i.id === 'short-score')) issues.push({ id: 'overhang', level: 'info', scoreSeconds: score.sungSeconds, duration, recommended, fix: 'length' });
    if (score.onsetSeconds !== null && score.onsetSeconds >= 2) issues.push({ id: 'late-start', level: 'info', onsetSeconds: score.onsetSeconds, scoreSeconds: score.sungSeconds, fix: trimLeadingRests(abc) ? 'trim' : null });
    return { score, syllables: syllableLines, issues };
  }

  // Removes whole bars of rest at the start of the Vocal voice, and the same
  // number of bars from the start of every other voice, but only when those
  // bars are rests there too; otherwise returns null and changes nothing.
  function trimLeadingRests(abc) {
    const lines = String(abc || '').split('\n');
    let voice = null, inBody = false;
    const firstLine = new Map();
    lines.forEach((line, index) => {
      const t = line.trim();
      const field = /^([A-Za-z]):\s*(.*)$/.exec(t);
      if (field) { if (field[1] === 'K') inBody = true; if (field[1] === 'V') voice = field[2].trim().split(/\s+/)[0]; return; }
      if (inBody && voice && t && !t.startsWith('%') && !firstLine.has(voice)) firstLine.set(voice, index);
    });
    const vocal = [...firstLine.keys()].find(v => /^vocal/i.test(v));
    if (!vocal) return null;
    const restBar = bar => /^\s*(?:[zx]\d*\s*)+$/.test(bar) || /^\s*[ZX]\d*\s*$/.test(bar);
    const barsOf = line => line.split('|');
    const leadingRestBars = line => {
      let count = 0;
      for (const bar of barsOf(line)) {
        if (!bar.trim()) break;
        const multi = /^\s*[ZX](\d*)\s*$/.exec(bar);
        if (multi) { count += multi[1] ? Number(multi[1]) : 1; continue; }
        if (restBar(bar)) { count++; continue; }
        break;
      }
      return count;
    };
    const drop = (line, count) => {
      const bars = barsOf(line);
      const kept = [];
      let remaining = count;
      for (const bar of bars) {
        if (remaining > 0 && bar.trim()) {
          const multi = /^\s*([ZX])(\d*)\s*$/.exec(bar);
          if (multi) {
            const n = multi[2] ? Number(multi[2]) : 1;
            if (n > remaining) { kept.push(`${multi[1]}${n - remaining}`); remaining = 0; } else remaining -= n;
            continue;
          }
          remaining--;
          continue;
        }
        kept.push(bar);
      }
      return kept.join('|');
    };
    const count = leadingRestBars(lines[firstLine.get(vocal)]);
    if (!count) return null;
    for (const [v, index] of firstLine) if (leadingRestBars(lines[index]) < count) return null;
    const out = [...lines];
    for (const [, index] of firstLine) out[index] = drop(lines[index], count);
    return { abc: out.join('\n'), bars: count };
  }

  // Swaps the music of each V: Vocal block with the V: Ins block that
  // follows it, section by section, so a tune the transcriber filed under
  // the instrument becomes the sung line and both voices keep their bars.
  // Returns null when there is no Vocal/Ins pair to swap.
  function swapVocalAndInstrument(abc) {
    const lines = String(abc || '').split('\n');
    const items = [];
    let inBody = false, current = null;
    for (const line of lines) {
      const t = line.trim();
      const field = /^([A-Za-z]):\s*(.*)$/.exec(t);
      if (field && field[1] === 'K' && !inBody) { inBody = true; items.push({ line }); continue; }
      if (inBody && field && field[1] === 'V') {
        current = { voice: field[2].trim().split(/\s+/)[0], header: line, content: [] };
        items.push(current);
        continue;
      }
      if (!inBody || !t || t.startsWith('%') || field) { current = null; items.push({ line }); continue; }
      if (current) current.content.push(line); else items.push({ line });
    }
    const blocks = items.filter(item => item.header);
    let swapped = 0;
    for (let i = 0; i + 1 < blocks.length; i++) {
      const vocal = blocks[i], ins = blocks[i + 1];
      if (!/^vocal/i.test(vocal.voice) || !/^ins/i.test(ins.voice)) continue;
      [vocal.content, ins.content] = [ins.content, vocal.content];
      swapped++;
      i++;
    }
    if (!swapped) return null;
    return items.flatMap(item => item.header ? [item.header, ...item.content] : [item.line]).join('\n');
  }

  const api = { splitSyllables, analyzeScore, checkMelody, trimLeadingRests, swapVocalAndInstrument };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MelodyCheck = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
