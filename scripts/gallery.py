#!/usr/bin/env python3
"""Refresh the browser library from completed audio files in outputs/."""
from datetime import datetime
from html import escape
from pathlib import Path
from urllib.parse import quote
import wave
import json

root = Path(__file__).resolve().parent.parent
directory = root / 'outputs'
directory.mkdir(exist_ok=True)
cards = []
tracks = sorted((p for p in directory.iterdir() if p.suffix.lower() in {'.wav', '.mp3'} and p.is_file()),
                key=lambda p: p.stat().st_mtime, reverse=True)
for i, path in enumerate(tracks):
    duration = ''
    if path.suffix.lower() == '.wav':
        try:
            with wave.open(str(path), 'rb') as audio:
                duration = f'{audio.getnframes() / audio.getframerate():.1f} seconds · {audio.getframerate() // 1000} kHz · '
        except (wave.Error, EOFError):
            continue
    url = quote(path.name)
    title = 'Krishna mantra' if path.stem.startswith('krishna-') else path.stem
    replay = path.with_suffix('.json')
    loop_prepared = False
    if replay.exists():
        try:
            request = json.loads(replay.read_text())
            style = request.get('style', '').lower()
            loop_prepared = request.get('_music_space', {}).get('loop_prepared', False)
            if 'one young adult female singer' in style:
                title += ' · Female vocal' + (' · Loop' if loop_prepared else ' · Raw take')
            elif 'lightly intoned speech' in style:
                title += ' · Light recitation'
                if request.get('duration') == 35:
                    title += ' · Romanized input' if 'Om Krishnaaya' in request.get('lyrics', '') else ' · Devanagari input'
            elif 'rhythmic hindu devotional chant' in style:
                title += ' · Rhythmic chant'
        except (ValueError, OSError, AttributeError):
            pass
    replay_link = f'<a href="{quote(replay.name)}" download>Save settings</a>' if replay.exists() else ''
    latest = '<span class="badge">Latest output</span>' if not cards else ''
    cards.append(f'''<article>{latest}<h2>{escape(title)}</h2>
<p>{duration}{datetime.fromtimestamp(path.stat().st_mtime).strftime('%d %b %Y, %H:%M')}</p>
<audio id="audio-{i}" controls preload="metadata" src="{url}" {'loop' if loop_prepared else ''}></audio>
<label><input type="checkbox" {'checked' if loop_prepared else ''} onchange="document.getElementById('audio-{i}').loop=this.checked"> Loop playback</label>
<div class="links"><a href="{url}" download>Download audio</a>{replay_link}</div>
<small>{escape(path.name)}</small></article>''')
html = '''<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Saved music · Music Space</title>
<style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#111318;color:#edf1f5}
body{max-width:850px;margin:auto;padding:32px 20px}nav{display:flex;justify-content:space-between;gap:20px}
a{color:#a5d8ff;text-underline-offset:4px}h1{font-size:36px;margin-bottom:8px}p,small{color:#aab5c4}
article{background:#1c222b;border:1px solid #35404e;border-radius:16px;padding:24px;margin-top:22px}
h2{margin:12px 0 6px}audio{width:100%;margin:14px 0}.links{display:flex;gap:24px;margin:8px 0 18px}
.badge{font-size:12px;background:#284f40;color:#bdffdc;border-radius:20px;padding:5px 10px}small{overflow-wrap:anywhere}
</style><nav><a href="/">← Music generator</a><a href="./">Refresh library</a></nav>
<h1>Saved music</h1><p>Your generated audio, newest first. Press play to listen.</p>
''' + (''.join(cards) or '<article>No saved audio yet.</article>') + '</html>'
temporary = directory / 'index.html.tmp'
temporary.write_text(html, encoding='utf-8')
temporary.replace(directory / 'index.html')
print(f'Updated browser library: {len(cards)} track(s).')
