// Fit editor UI: the drag-to-fit editor that sits under the score box. The
// logic (what a tie, slur or merge does to the score) lives in fit-editor.js;
// this file only draws lanes, handles pointer and keyboard input, plays the
// preview and draws the staff notation.
(function (root) {
  const F = root.FitEditor, MC = root.MelodyCheck;
  const NS = 'http://www.w3.org/2000/svg';
  const MIN_NOTE = 72, NOTE_H = 16, PITCH_PX = 6, COACH_KEY = 'fit-editor-coach';
  const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const noteName = midi => NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
  const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
  const svg = (tag, attrs = {}, text) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (text !== undefined) n.textContent = text; return n; };
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const store = { get: () => { try { return localStorage.getItem(COACH_KEY); } catch { return null; } }, set: () => { try { localStorage.setItem(COACH_KEY, '1'); } catch { /* private window */ } } };

  function mount({ host, getAbc, setAbc, getLyrics, onApplied }) {
    const s = { open: false, model: null, phrases: [], history: [], future: [], original: '', assign: [], selected: null, preview: null, pending: null, playing: null, written: null, openStaff: new Set(), status: '' };
    let audio = null, timers = [], tones = [];

    // ---- state ----------------------------------------------------------
    const current = () => s.preview || s.phrases;
    const lyricLines = () => s.model.lyricLines;
    const withTargets = phrases => phrases.map((p, i) => ({ ...p, lyricLine: s.assign[i], target: F.targetFor(lyricLines(), s.assign[i]) }));
    function load(abc) {
      s.model = F.parse(abc, getLyrics());
      s.assign = s.model.assignment.slice();
      s.phrases = s.model.phrases;
      s.original = abc; s.written = abc; s.lyricsText = getLyrics();
      s.history = []; s.future = []; s.selected = null; s.preview = null; s.pending = null;
    }
    function commit(next, status) {
      s.history.push(s.phrases); if (s.history.length > 60) s.history.shift();
      s.future = []; s.phrases = withTargets(next); s.preview = null; s.pending = null; s.status = status || '';
      render();
    }
    function undo() { if (!s.history.length) return; s.future.push(s.phrases); s.phrases = s.history.pop(); s.selected = null; s.status = ''; render(); }
    function redo() { if (!s.future.length) return; s.history.push(s.phrases); s.phrases = s.future.pop(); s.selected = null; s.status = ''; render(); }
    function reset() { load(s.original); s.status = 'Back to the score as it was when you opened this.'; render(); }
    const dirty = () => s.phrases.some(p => p.dirty);
    const replaceAt = (i, phrase) => current().map((p, k) => (k === i ? phrase : p));

    // ---- open / close / apply -------------------------------------------
    function open() {
      const abc = getAbc();
      if (!abc.trim()) return false;
      load(abc); s.open = true; s.openStaff = new Set(); render();
      for (let n = host; n; n = n.parentElement) if (n.tagName === 'DETAILS') n.open = true;
      return true;
    }
    function close() { stopAudio(); s.open = false; render(); }
    function apply() {
      const abc = F.toAbc(s.model, s.phrases);
      s.written = abc; setAbc(abc); s.original = abc;
      s.model = F.parse(abc, getLyrics()); s.phrases = withTargets(s.model.phrases); s.history = []; s.future = []; s.selected = null;
      s.status = 'Written to the score.'; render();
      if (onApplied) onApplied();
    }
    // Typing in the score box while the editor is open re-reads the score.
    function scoreChanged() {
      if (!s.open) { render(); return; }
      if (getAbc() !== s.written) { load(getAbc()); s.status = 'Score changed — the editor re-read it.'; render(); return; }
      if (getLyrics() !== s.lyricsText) { s.lyricsText = getLyrics(); s.model = { ...s.model, lyricLines: MC.splitSyllables(s.lyricsText) }; s.assign = s.phrases.map((p, i) => (i < s.model.lyricLines.length ? i : -1)); s.phrases = withTargets(s.phrases); render({ keepScroll: true }); }
    }

    // ---- geometry -------------------------------------------------------
    // One layout per lane: x for every item, y for every pitch. Widths follow
    // note length but never get narrower than a readable syllable.
    function layout(phrase, scale) {
      const d = F.describe(phrase, s.model.header);
      const midis = d.notes.map(n => n.midi), lo = Math.min(...midis), hi = Math.max(...midis);
      const pp = Math.min(PITCH_PX, 60 / Math.max(1, hi - lo));
      const height = Math.round((hi - lo) * pp + NOTE_H + 8);
      let x = 6;
      const boxes = [];
      for (const it of d.items) {
        if (it.kind === 'bar') { boxes.push({ ...it, x, w: 10 }); x += 10; }
        else if (it.kind === 'rest') { const w = Math.max(14, Math.min(120, it.len * scale)); boxes.push({ ...it, x, w }); x += w; }
        else { const w = Math.max(MIN_NOTE, it.len * scale); boxes.push({ ...it, x, w, y: Math.round((hi - it.midi) * pp) + 4 }); x += w + 3; }
      }
      return { d, boxes, width: x + 12, height };
    }
    const scaleFor = phrases => {
      const lens = phrases.flatMap(p => F.describe(p, s.model.header).notes.map(n => n.len));
      return 46 / Math.max(1, lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length));
    };
    // Syllables sit on groups in order; extras have no note, extra notes hum.
    function syllablesFor(phrase) {
      if (phrase.lyricLine === -2) return lyricLines().flat();
      return phrase.lyricLine >= 0 && lyricLines()[phrase.lyricLine] ? lyricLines()[phrase.lyricLine] : [];
    }

    // ---- gestures -------------------------------------------------------
    // Stretch a syllable so it ends on note `last`: later notes join it,
    // or, going back, the notes after `last` get released.
    function extent(phrase, group, last) {
      let p = phrase, d = F.describe(p, s.model.header);
      const g = d.groups[group], end = g[g.length - 1];
      if (last > end) {
        for (let i = end; i < last; i++) {
          const a = d.notes[i], b = d.notes[i + 1];
          const next = F.setLink(p, i, a.midi === b.midi ? 'tie' : 'slur');
          if (!next) break;
          p = next;
        }
      } else if (last < end && last >= g[0]) p = F.setLink(p, last, 'none') || p;
      return p;
    }
    function startStretch(event, pi, group) {
      event.preventDefault();
      const lane = event.currentTarget.closest('.fit-roll'), base = s.phrases[pi];
      const { boxes } = layout(base, scaleFor(s.phrases));
      const rect = lane.getBoundingClientRect(), startX = lane.scrollLeft;
      const notes = boxes.filter(b => b.kind === 'note');
      const move = e => {
        const x = e.clientX - rect.left + lane.scrollLeft;
        let last = 0;
        notes.forEach((n, i) => { if (n.x + n.w / 2 < x) last = i; });
        const g = F.describe(base, s.model.header).groups[group];
        last = Math.max(g[0], last);
        const p = extent(base, group, last);
        s.preview = replaceAt(pi, p); s.pending = null; render({ keepScroll: true });
      };
      const up = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
        if (s.preview && s.preview[pi] !== base) { const next = s.preview; s.preview = null; commit(next, 'Syllable stretched.'); } else { s.preview = null; render({ keepScroll: true }); }
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
      void startX;
    }
    function nudge(pi, group, direction) {
      const p = F.stretch(s.phrases[pi], group, direction);
      if (!p) { s.status = direction > 0 ? 'Nothing more to hold here — a rest or the end of the line.' : 'This syllable already has just one note.'; render(); return; }
      s.selected = { phrase: pi, note: F.describe(p, s.model.header).groups[group][0] };
      commit(replaceAt(pi, p), direction > 0 ? 'Syllable holds one more note.' : 'Syllable holds one fewer note.');
    }
    function split(pi, note) {
      const p = F.splitNote(s.phrases[pi], note);
      if (!p) { s.status = 'That note is too short to split.'; render(); return; }
      commit(replaceAt(pi, p), 'Note split in two — the spare half takes the next syllable.');
    }
    function tidy(pi) {
      const out = s.phrases.map((p, i) => (pi === undefined || pi === i ? F.tieRepeats(p) || p : p));
      if (out.every((p, i) => p === s.phrases[i])) { s.status = 'No repeated notes to tie.'; render(); return; }
      commit(out, 'Repeated notes tied — every note and the tune are kept.');
    }
    function suggest(pi) {
      const base = s.phrases;
      const out = base.map((p, i) => (p.target && (pi === undefined || pi === i) && p.editable ? F.autoFit(p, p.target) : p));
      if (out.every((p, i) => p === base[i])) { s.status = 'Already fits.'; render(); return; }
      s.preview = out; s.pending = { lane: pi }; render();
    }
    function accept() { const next = s.preview; s.preview = null; s.pending = null; commit(next, 'Suggestion kept.'); }
    function discard() { s.preview = null; s.pending = null; s.status = ''; render(); }
    function asRests(pi) { const p = F.toRests(s.phrases[pi]); if (p) commit(replaceAt(pi, p), 'Turned into rests.'); }

    // ---- listening ------------------------------------------------------
    function stopAudio() {
      timers.forEach(clearTimeout); timers = [];
      tones.forEach(o => { try { o.stop(); } catch { /* already stopped */ } }); tones = [];
      s.playing = null; document.querySelectorAll('.fit-editor .playing').forEach(n => n.classList.remove('playing'));
      const b = host.querySelector('.fit-play-all'); if (b) b.textContent = '▶ Play all';
    }
    function play(indexes) {
      if (s.playing) { stopAudio(); render({ keepScroll: true }); return; }
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) { s.status = 'This browser can’t play the preview.'; render(); return; }
      audio = audio || new AudioCtx(); if (audio.state === 'suspended') audio.resume();
      s.playing = indexes.join(','); let at = audio.currentTime + 0.1, offset = 0.1;
      for (const pi of indexes) {
        const sch = F.schedule(current()[pi], s.model.header);
        for (const ev of sch.events) {
          const osc = audio.createOscillator(), gain = audio.createGain(), start = at + ev.start, end = start + Math.max(0.08, ev.duration);
          osc.type = 'triangle'; osc.frequency.value = 440 * 2 ** ((ev.midi - 69) / 12);
          gain.gain.setValueAtTime(0.0001, start); gain.gain.exponentialRampToValueAtTime(0.25, start + 0.03); gain.gain.setValueAtTime(0.25, Math.max(start + 0.03, end - 0.08)); gain.gain.exponentialRampToValueAtTime(0.0001, end);
          osc.connect(gain).connect(audio.destination); osc.start(start); osc.stop(end + 0.02); tones.push(osc);
          timers.push(setTimeout(() => {
            document.querySelectorAll('.fit-editor .playing').forEach(n => n.classList.remove('playing'));
            host.querySelectorAll(`[data-phrase="${pi}"][data-group="${ev.group}"], [data-phrase="${pi}"][data-note="${ev.notes[0]}"]`).forEach(n => n.classList.add('playing'));
          }, (offset + ev.start) * 1000));
        }
        at += sch.seconds + 0.5; offset += sch.seconds + 0.5;
      }
      timers.push(setTimeout(() => { stopAudio(); render({ keepScroll: true }); }, (offset) * 1000));
      const b = host.querySelector('.fit-play-all'); if (b) b.textContent = '■ Stop';
      host.querySelectorAll('.fit-play').forEach(n => { n.textContent = '■ Stop'; });
    }

    // ---- notation -------------------------------------------------------
    // A small engraver: treble staff, key signature, noteheads with stems,
    // dots, flags, ties for long notes, real slurs and ties, and the lyrics
    // under each syllable's first note.
    const STD = [1, 1 / 2, 1 / 4, 1 / 8, 1 / 16, 1 / 32, 1 / 64];
    function durations(whole) {
      const parts = []; let r = whole;
      for (const v of STD) while (r >= v - 1e-6) { parts.push({ v, dots: 0 }); r -= v; }
      for (let i = 0; i + 1 < parts.length; i++) if (Math.abs(parts[i + 1].v - parts[i].v / 2) < 1e-9 && !parts[i].dots) { parts[i].dots = 1; parts.splice(i + 1, 1); }
      return parts.length ? parts : [{ v: 1 / 64, dots: 0 }];
    }
    function staff(phrase, header, sig) {
      const L = 'CDEFGAB', GAP = 4, bottom = 70, top = bottom - 32;
      const d = F.describe(phrase, header), sylls = syllablesFor(phrase);
      const pos = n => Number(n.marks.split('').reduce((o, c) => o + (c === "'" ? 1 : -1), n.letter === n.letter.toUpperCase() ? 4 : 5)) * 7 + L.indexOf(n.letter.toUpperCase());
      const y = n => bottom - (pos(n) - 30) * GAP;
      const flats = Object.entries(sig).filter(([, a]) => a < 0).map(([k]) => k), sharps = Object.entries(sig).filter(([, a]) => a > 0).map(([k]) => k);
      const keyPos = { sharp: { F: 38, C: 35, G: 39, D: 36, A: 33, E: 37, B: 34 }, flat: { B: 34, E: 37, A: 33, D: 36, G: 32, C: 35, F: 31 } };
      const out = svg('svg', { class: 'fit-staff', role: 'img', 'aria-label': `Notation for line: ${plural(d.groupCount, 'syllable')} on ${plural(d.noteCount, 'note')}`, height: 150 });
      let x = 8;
      for (let i = 0; i < 5; i++) out.append(svg('line', { x1: 0, x2: 0, y1: top + i * 8, y2: top + i * 8, class: 'staff-line', 'data-line': i }));
      const clef = svg('g', { class: 'clef', transform: `translate(${x - 4} 0)` });
      clef.append(svg('path', { d: 'M18 22 C28 29 22 42 16 52 L13 76 C12 85 3 83 5 77 C6 73 12 74 11 79', fill: 'none' }), svg('path', { d: 'M16 52 C3 50 5 65 15 66 C24 67 26 55 17 54 C12 53 11 59 15 60', fill: 'none' }));
      out.append(clef); x += 34;
      const order = sharps.length ? 'FCGDAEB' : 'BEADGCF';
      (sharps.length ? sharps : flats).sort((a, b) => order.indexOf(a) - order.indexOf(b)).forEach(k => {
        const p = (sharps.length ? keyPos.sharp : keyPos.flat)[k];
        out.append(svg('text', { x, y: bottom - (p - 30) * GAP + 4, class: 'accidental' }, sharps.length ? '♯' : '♭')); x += 9;
      });
      x += 10;
      const avg = d.notes.reduce((a, n) => a + n.len, 0) / Math.max(1, d.notes.length);
      const heads = [], unit = header.unit;
      let barAlter = {}, groupSeen = -1;
      for (const it of d.items) {
        if (it.kind === 'bar') { out.append(svg('line', { x1: x, x2: x, y1: top, y2: bottom, class: 'bar-line' })); barAlter = {}; x += 12; continue; }
        const parts = durations(it.len * unit);
        const firstOfGroup = it.kind === 'note' && it.group !== groupSeen, word = firstOfGroup && sylls[it.group] !== undefined ? sylls[it.group].length * 7.4 + 12 : 0;
        const w = Math.max(24, Math.min(64, 18 + 14 * Math.sqrt(it.len / avg)), word);
        if (it.kind === 'rest') {
          parts.forEach((p, k) => {
            const cx = x + k * 14 + 8;
            if (p.v >= 1 / 2) out.append(svg('rect', { x: cx - 5, y: p.v === 1 ? top + 8 : top + 12, width: 10, height: 4, class: 'rest' }));
            else out.append(svg('path', { d: `M${cx - 2} ${top + 6} l5 6 l-5 6 l5 6`, class: 'rest-mark', fill: 'none' }));
          });
          x += w; continue;
        }
        const sy = y(it), cx = x + 10, selected = s.selected && s.selected.note === it.index;
        const letter = it.letter.toUpperCase() + pos(it), implied = letter in barAlter ? barAlter[letter] : (sig[it.letter.toUpperCase()] || 0);
        const grp = svg('g', { class: `nt${it.group === (s.selected && groupAt(phrase, s.selected.note)) ? ' sel' : ''}`, 'data-phrase': phrase.id, 'data-group': it.group, 'data-note': it.index });
        if (it.alter !== implied) { grp.append(svg('text', { x: cx - 15, y: sy + 4, class: 'accidental' }, it.alter === 0 ? '♮' : it.alter > 0 ? '♯' : '♭')); barAlter[letter] = it.alter; }
        // ledger lines
        for (let p = 28; p >= pos(it); p -= 2) if (p < 30) grp.append(svg('line', { x1: cx - 8, x2: cx + 8, y1: bottom - (p - 30) * GAP, y2: bottom - (p - 30) * GAP, class: 'staff-line' }));
        for (let p = 40; p <= pos(it); p += 2) if (p > 38) grp.append(svg('line', { x1: cx - 8, x2: cx + 8, y1: bottom - (p - 30) * GAP, y2: bottom - (p - 30) * GAP, class: 'staff-line' }));
        parts.forEach((p, k) => {
          const hx = cx + k * 16, filled = p.v <= 1 / 4, up = pos(it) < 34;
          grp.append(svg('ellipse', { cx: hx, cy: sy, rx: 5.4, ry: 3.8, transform: `rotate(-20 ${hx} ${sy})`, class: filled ? 'head filled' : 'head' }));
          if (p.v < 1) {
            const sx = up ? hx + 4.9 : hx - 4.9, ey = up ? sy - 26 : sy + 26;
            grp.append(svg('line', { x1: sx, x2: sx, y1: sy, y2: ey, class: 'stem' }));
            for (let f = 0; f < Math.max(0, Math.round(Math.log2(1 / p.v)) - 2); f++) grp.append(svg('path', { d: up ? `M${sx} ${ey + f * 5} q8 5 5 13` : `M${sx} ${ey - f * 5} q8 -5 5 -13`, class: 'flag', fill: 'none' }));
          }
          if (p.dots) grp.append(svg('circle', { cx: hx + 9, cy: sy + (((pos(it) - 30) % 2 === 0) ? -2.5 : 0), r: 1.5, class: 'dot' }));
          if (k > 0) grp.append(svg('path', { d: `M${hx - 14} ${sy + (up ? 8 : -8)} q8 ${up ? 6 : -6} 16 0`, class: 'tie', fill: 'none' }));
        });
        if (selected) grp.append(svg('circle', { cx, cy: sy, r: 9, class: 'pick', fill: 'none' }));
        out.append(grp);
        heads.push({ ...it, x: cx, y: sy, up: pos(it) < 34, w });
        const isFirst = it.group !== groupSeen; groupSeen = it.group;
        if (isFirst) out.append(svg('text', { x: cx - 6, y: bottom + 52, class: 'lyric', 'data-phrase': phrase.id, 'data-group': it.group }, sylls[it.group] !== undefined ? sylls[it.group] : '~'));
        x += w + (parts.length - 1) * 16;
      }
      // Ties and slurs between neighbouring heads.
      heads.forEach((a, i) => {
        const b = heads[i + 1];
        if (!b || a.link === 'none') return;
        const below = a.up, dy = below ? 1 : -1, y1 = (below ? Math.max(a.y, b.y) : Math.min(a.y, b.y)) + dy * 8;
        if (a.link === 'tie') out.append(svg('path', { d: `M${a.x + 3} ${a.y + dy * 7} Q${(a.x + b.x) / 2} ${y1 + dy * 7} ${b.x - 3} ${b.y + dy * 7}`, class: 'tie', fill: 'none' }));
        else out.append(svg('path', { d: `M${a.x} ${a.y + dy * 8} Q${(a.x + b.x) / 2} ${y1 + dy * 14} ${b.x} ${b.y + dy * 8}`, class: 'slur', fill: 'none' }));
      });
      const width = x + 20;
      out.setAttribute('width', width);
      out.querySelectorAll('[data-line]').forEach(l => l.setAttribute('x2', width));
      return out;
    }
    const groupAt = (phrase, note) => { const d = F.describe(phrase, s.model.header); const n = d.notes[note]; return n ? n.group : -1; };

    // ---- rendering ------------------------------------------------------
    function laneView(phrase, pi, scale) {
      const { d, boxes, width, height } = layout(phrase, scale);
      const sylls = syllablesFor(phrase), state = phrase.target ? F.fitState(d.groupCount, phrase.target) : { state: 'none', diff: 0 };
      const lane = el('section', `fit-lane ${state.state}${phrase.editable ? '' : ' readonly'}`);
      lane.setAttribute('aria-label', phrase.target ? `Line ${pi + 1}: ${plural(phrase.target, 'syllable')} on ${plural(d.groupCount, 'note group')}` : `Tune line ${pi + 1}: no words`);
      // header
      const head = el('div', 'fit-lane-head');
      const title = el('div', 'fit-lane-title');
      const label = phrase.target
        ? (state.state === 'fits' ? `✓ Line ${pi + 1} · ${plural(d.groupCount, 'syllable')} · ${plural(d.noteCount, 'note')}`
          : state.state === 'close' ? `≈ Line ${pi + 1} · ${d.groupCount} note groups for ${plural(phrase.target, 'syllable')} — close enough`
            : `Line ${pi + 1} · ${plural(phrase.target, 'syllable')} · ${plural(d.groupCount, 'note group')} (${state.diff > 0 ? `${state.diff} too many` : `${-state.diff} too few`})`)
        : `Tune line ${pi + 1} · no words here · ${plural(d.noteCount, 'note')}`;
      title.append(el('strong', '', label));
      head.append(title);
      const tools = el('div', 'fit-lane-tools');
      const listen = el('button', 'fit-play fit-small', s.playing === String(pi) ? '■ Stop' : '▶ Listen'); listen.type = 'button'; listen.onclick = () => play([pi]); tools.append(listen);
      if (phrase.editable && phrase.target && state.state !== 'fits') { const b = el('button', 'fit-small', 'Fit this line'); b.type = 'button'; b.onclick = () => suggest(pi); tools.append(b); }
      head.append(tools); lane.append(head);
      if (!phrase.editable) { lane.append(el('p', 'fit-hint', `${phrase.reason}. This line is left exactly as written.`)); }
      // which lyric line sings here, when the counts don't line up
      if (lyricLines().length !== s.phrases.length || s.assign.some((a, i) => a !== i && a >= 0)) {
        const pick = el('label', 'fit-assign', 'Sings: '); const sel = el('select'); sel.setAttribute('aria-label', `Which lyric line goes on tune line ${pi + 1}`);
        if (lyricLines().length > 1 && s.phrases.length === 1) sel.add(new Option(`All ${lyricLines().length} lyric lines`, '-2', false, phrase.lyricLine === -2));
        lyricLines().forEach((l, k) => sel.add(new Option(`Line ${k + 1} · ${l.slice(0, 3).join('')}…`, String(k), false, phrase.lyricLine === k)));
        sel.add(new Option('No words (humming)', '-1', false, phrase.lyricLine === -1));
        sel.onchange = () => { s.assign[pi] = Number(sel.value); s.phrases = withTargets(s.phrases); render(); };
        pick.append(sel); lane.append(pick);
      }
      // roll: chips above, blocks below, in one horizontal scroller
      const roll = el('div', 'fit-roll'); roll.dataset.phrase = pi;
      const inner = el('div', 'fit-inner'); inner.style.width = `${width + (sylls.length > d.groupCount ? 70 * (sylls.length - d.groupCount) : 0)}px`;
      const chips = el('div', 'fit-chips'); const canvas = el('div', 'fit-canvas'); canvas.style.height = `${height}px`;
      const notesBox = boxes.filter(b => b.kind === 'note');
      const selectedGroup = s.selected && s.selected.phrase === pi ? groupAt(phrase, s.selected.note) : -1;
      d.groups.forEach((g, gi) => {
        const a = notesBox[g[0]], z = notesBox[g[g.length - 1]];
        const syllable = sylls[gi];
        const chip = el('button', `fit-chip${syllable === undefined ? ' hum' : ''}${selectedGroup === gi ? ' sel' : ''}${g.length > 1 ? ' holds' : ''}`);
        chip.type = 'button'; chip.dataset.phrase = pi; chip.dataset.group = gi;
        chip.style.left = `${a.x}px`; chip.style.width = `${z.x + z.w - a.x}px`;
        chip.append(el('span', 'fit-chip-text', syllable === undefined ? '~' : syllable));
        chip.setAttribute('aria-label', syllable === undefined ? `Note ${gi + 1}, no syllable, hums` : `Syllable ${gi + 1}, ${syllable}, holds ${plural(g.length, 'note')}. Press right arrow to hold one more note, left arrow for one fewer.`);
        chip.onclick = () => { s.selected = selectedGroup === gi ? null : { phrase: pi, note: g[0] }; render({ keepScroll: true }); };
        chip.onkeydown = e => { if (e.key === 'ArrowRight') { e.preventDefault(); nudge(pi, gi, +1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(pi, gi, -1); } };
        if (phrase.editable) {
          const grip = el('span', 'fit-grip'); grip.setAttribute('aria-hidden', 'true'); grip.title = 'Drag to hold more notes';
          grip.addEventListener('pointerdown', e => { s.selected = { phrase: pi, note: g[0] }; startStretch(e, pi, gi); });
          chip.append(grip);
        }
        chips.append(chip);
      });
      let spillX = (notesBox.length ? notesBox[notesBox.length - 1].x + notesBox[notesBox.length - 1].w : 0) + 10;
      sylls.slice(d.groupCount).forEach(text => { const c = el('span', 'fit-chip spill', text); c.style.left = `${spillX}px`; c.style.width = '64px'; spillX += 68; chips.append(c); });
      for (const b of boxes) {
        if (b.kind === 'bar') { const bar = el('i', 'fit-bar'); bar.style.left = `${b.x + 4}px`; canvas.append(bar); }
        else if (b.kind === 'rest') { const r = el('i', 'fit-rest'); r.style.left = `${b.x}px`; r.style.width = `${b.w}px`; canvas.append(r); }
      }
      const svgLinks = svg('svg', { class: 'fit-links', width, height });
      notesBox.forEach((b, i) => {
        const node = el('button', `fit-note${b.group === selectedGroup ? ' sel' : ''}${b.link !== 'none' ? ' linked' : ''}`);
        node.type = 'button'; node.dataset.phrase = pi; node.dataset.note = b.index; node.dataset.group = b.group;
        node.style.left = `${b.x}px`; node.style.width = `${b.w}px`; node.style.top = `${b.y}px`; node.style.height = `${NOTE_H}px`;
        node.title = noteName(b.midi); node.setAttribute('aria-label', `Note ${b.index + 1}, ${noteName(b.midi)}`);
        node.onclick = () => { s.selected = s.selected && s.selected.phrase === pi && s.selected.note === b.index ? null : { phrase: pi, note: b.index }; render({ keepScroll: true }); };
        canvas.append(node);
        const next = notesBox[i + 1];
        if (next && b.link !== 'none') {
          const x1 = b.x + b.w, x2 = next.x, y1 = b.y + NOTE_H / 2, y2 = next.y + NOTE_H / 2, mid = (x1 + x2) / 2;
          if (b.link === 'tie') svgLinks.append(svg('path', { d: `M${x1 - 2} ${y1} L${x2 + 2} ${y2}`, class: 'link-tie' }));
          else svgLinks.append(svg('path', { d: `M${x1 - 6} ${b.y} Q${mid} ${Math.min(b.y, next.y) - 14} ${x2 + 6} ${next.y}`, class: 'link-slur', fill: 'none' }));
        }
      });
      canvas.append(svgLinks);
      inner.append(chips, canvas); roll.append(inner); lane.append(roll);
      // selection bar
      if (s.selected && s.selected.phrase === pi && phrase.editable) lane.append(selectionBar(phrase, pi, d, selectedGroup));
      // no words here
      if (!phrase.target && phrase.editable) {
        const row = el('div', 'fit-tail');
        const keep = el('span', 'fit-hint', 'These notes have no words — the singer will hum them.');
        const rests = el('button', 'fit-small', 'Turn into rests'); rests.type = 'button'; rests.onclick = () => asRests(pi);
        row.append(keep, rests); lane.append(row);
      }
      // notation
      const staffBox = el('details', 'fit-staff-box'); staffBox.open = s.openStaff.has(pi);
      staffBox.addEventListener('toggle', () => { if (staffBox.open) s.openStaff.add(pi); else s.openStaff.delete(pi); if (staffBox.open && !staffBox.querySelector('svg')) { staffBox.append(wrapStaff(phrase)); } });
      staffBox.append(el('summary', '', 'Show notation'));
      if (staffBox.open) staffBox.append(wrapStaff(phrase));
      lane.append(staffBox);
      return lane;
    }
    function wrapStaff(phrase) { const box = el('div', 'fit-staff-scroll'); box.append(staff(phrase, s.model.header, s.model.sig)); return box; }

    function selectionBar(phrase, pi, d, group) {
      const bar = el('div', 'fit-select'), g = d.groups[group], note = d.notes[s.selected.note];
      const text = g.length === 1 ? `${noteName(note.midi)} · one note` : `${plural(g.length, 'note')} on one syllable`;
      bar.append(el('span', 'fit-select-text', text));
      const add = (label, fn, disabled, title) => { const b = el('button', 'fit-small', label); b.type = 'button'; b.onclick = fn; if (disabled) b.disabled = true; if (title) b.title = title; bar.append(b); return b; };
      add('Hold one more note ▸', () => nudge(pi, group, +1), group + 1 >= d.groups.length);
      add('◂ One fewer', () => nudge(pi, group, -1), g.length < 2);
      add('✂ Split this note', () => split(pi, s.selected.note), note.len / 2 < 0.5);
      if (g.length > 1) {
        const blocked = F.mergeBlocked(phrase, group);
        const more = el('details', 'fit-merge');
        more.append(el('summary', '', 'Turn into one held note…'));
        more.append(el('p', 'fit-hint', blocked === 'barline' ? 'A single held note can’t cross a bar line — keep the notes joined with a slur instead.' : 'This replaces the notes with one longer note. Pick the pitch that stays — it changes the tune, so the joined version above is the gentler choice.'));
        if (!blocked) {
          const row = el('div', 'fit-pitches');
          g.forEach(i => { const b = el('button', 'fit-small', noteName(d.notes[i].midi)); b.type = 'button'; b.onclick = () => { const p = F.mergeToHeld(phrase, group, i); if (p) { s.selected = null; commit(replaceAt(pi, p), `Merged into one ${noteName(d.notes[i].midi)}.`); } }; row.append(b); });
          more.append(row);
        }
        bar.append(more);
      }
      return bar;
    }

    function render(opts = {}) {
      const scrolls = opts.keepScroll ? [...host.querySelectorAll('.fit-roll')].map(r => r.scrollLeft) : [];
      stopAudioIfIdle();
      host.replaceChildren();
      const hasBoth = getAbc().trim() && getLyrics().trim() && (() => { try { return F.parse(getAbc(), getLyrics()).phrases.length > 0; } catch { return false; } })();
      if (!s.open) {
        if (hasBoth) { const link = el('button', 'fit-link', 'Adjust how the words sit on the notes'); link.type = 'button'; link.onclick = open; host.append(link); }
        return;
      }
      const cur = current();
      const scale = scaleFor(cur);
      const box = el('section', 'fit-editor'); box.setAttribute('aria-label', 'Fit words to notes');
      const top = el('div', 'fit-top');
      top.append(el('h4', '', 'Fit words to notes'));
      const closeBtn = el('button', 'fit-small fit-close', 'Close'); closeBtn.type = 'button'; closeBtn.onclick = close; top.append(closeBtn);
      box.append(top);
      if (!store.get()) {
        const coach = el('div', 'fit-coach');
        const demo = el('div', 'fit-demo'); demo.setAttribute('aria-hidden', 'true'); demo.append(el('span', 'fit-demo-chip', 'Kri'), el('i'), el('i'), el('i'));
        const words = el('p', '', 'Each syllable needs one note. Drag a syllable’s edge to let it hold several notes — the tune stays.');
        const ok = el('button', 'fit-small', 'Got it'); ok.type = 'button'; ok.onclick = () => { store.set(); render({ keepScroll: true }); };
        coach.append(demo, words, ok); box.append(coach);
      }
      const bar = el('div', 'fit-toolbar');
      const tb = (label, fn, disabled, cls) => { const b = el('button', `fit-small ${cls || ''}`, label); b.type = 'button'; b.onclick = fn; if (disabled) b.disabled = true; bar.append(b); return b; };
      tb('Tie repeated notes', () => tidy(), !s.phrases.some(p => p.editable));
      tb('Fit all lines', () => suggest(), !s.phrases.some(p => p.target && p.editable));
      tb('▶ Play all', () => play(cur.map((p, i) => i)), false, 'fit-play-all');
      tb('↶ Undo', undo, !s.history.length); tb('↷ Redo', redo, !s.future.length); tb('Reset', reset, !dirty() && !s.history.length);
      box.append(bar);
      if (s.pending) {
        const ban = el('div', 'fit-pending'); ban.setAttribute('role', 'status');
        ban.append(el('span', '', 'Suggestion — look, listen, then keep it or not. Nothing is written to the score yet.'));
        const yes = el('button', 'fit-small', 'Keep it'); yes.type = 'button'; yes.onclick = accept;
        const no = el('button', 'fit-small', 'Not now'); no.type = 'button'; no.onclick = discard; ban.append(yes, no); box.append(ban);
      }
      if (s.status) { const st = el('p', 'fit-status', s.status); st.setAttribute('role', 'status'); box.append(st); }
      const lanes = el('div', 'fit-lanes');
      cur.forEach((p, i) => lanes.append(laneView({ ...p, id: i }, i, scale)));
      box.append(lanes);
      const total = cur.reduce((n, p) => n + (p.target ? 1 : 0), 0);
      const fine = cur.filter(p => p.target && ['fits', 'close'].includes(F.fitState(F.describe(p, s.model.header).groupCount, p.target).state)).length;
      const foot = el('div', 'fit-foot');
      foot.append(el('span', 'muted', total ? `${fine} of ${total} lines fit.` : 'No lyric lines to fit.'));
      const applyBtn = el('button', 'fit-apply', dirty() ? 'Apply to score' : 'Nothing to apply'); applyBtn.type = 'button'; applyBtn.disabled = !dirty() || !!s.preview; applyBtn.onclick = apply;
      foot.append(applyBtn); box.append(foot);
      const why = el('details', 'check-why'); why.append(el('summary', '', 'Why one note per syllable?'), el('p', '', 'The model was trained on songs with one syllable per note, so it sings most clearly when the score gives each syllable exactly one. A tie or slur lets a syllable hold several notes without losing the tune. It’s a guide, not a rule: a few extra notes still sing clearly.'));
      box.append(why);
      host.append(box);
      host.querySelectorAll('.fit-roll').forEach((r, i) => { if (scrolls[i]) r.scrollLeft = scrolls[i]; });
    }
    function stopAudioIfIdle() { /* keep the tones playing across re-renders; classes are reapplied by the timers */ }

    const api = { open, close, render, isOpen: () => s.open, scoreChanged };
    render();
    return api;
  }
  root.FitEditorUI = { mount };
})(typeof globalThis !== 'undefined' ? globalThis : this);
