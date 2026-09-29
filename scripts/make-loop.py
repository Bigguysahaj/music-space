#!/usr/bin/env python3
"""Trim quiet edges and soften a PCM16 WAV's loop boundary; retain the source."""
import argparse
import array
import json
import math
from pathlib import Path
import sys
import wave

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path)
parser.add_argument('--start', type=float, help='Optional listening-selected start in seconds')
parser.add_argument('--end', type=float, help='Optional listening-selected end in seconds')
args = parser.parse_args()
with wave.open(str(args.source), 'rb') as wav:
    params = wav.getparams()
    if params.sampwidth != 2:
        raise SystemExit('Expected 16-bit PCM WAV')
    pcm = array.array('h', wav.readframes(wav.getnframes()))
if sys.byteorder != 'little':
    pcm.byteswap()
channels, rate, frames = params.nchannels, params.framerate, params.nframes
window = max(1, int(rate * .02))
levels = []
for frame in range(0, frames, window):
    chunk = pcm[frame * channels:min(frames, frame + window) * channels]
    levels.append(math.sqrt(sum(v*v for v in chunk) / max(1, len(chunk))))
threshold = max(32, max(levels, default=0) * .025)
active = [i for i, value in enumerate(levels) if value > threshold]
if not active:
    raise SystemExit('No audible signal detected; no loop created')
padding = int(rate * .15)
start = max(0, active[0] * window - padding)
end = min(frames, (active[-1] + 1) * window + padding)
if args.start is not None:
    start = round(args.start * rate)
if args.end is not None:
    end = round(args.end * rate)
if not 0 <= start < end <= frames:
    raise SystemExit('Invalid trim range')
result = pcm[start * channels:end * channels]
fade = min(round(rate * .015), (end - start) // 2)
for i in range(fade):
    gain = math.sin((i / max(1, fade - 1)) * math.pi / 2) ** 2
    for channel in range(channels):
        first = i * channels + channel
        last = (end - start - 1 - i) * channels + channel
        result[first] = round(result[first] * gain)
        result[last] = round(result[last] * gain)
target = args.source.with_name(args.source.stem + '-loop.wav')
if sys.byteorder != 'little':
    result.byteswap()
with wave.open(str(target), 'wb') as wav:
    wav.setparams(params)
    wav.writeframes(result.tobytes())
replay = args.source.with_suffix('.json')
metadata = json.loads(replay.read_text()) if replay.exists() else {}
metadata['_music_space'] = {
    'loop_prepared': True, 'source': args.source.name,
    'start_seconds': start / rate, 'end_seconds': end / rate,
    'fade_ms': 15, 'duration_seconds': (end - start) / rate,
    'note': 'Quiet-edge trimming and click-reduction fades only; no verified vocal alignment or source separation.'
}
target.with_suffix('.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'output': str(target), **metadata['_music_space']}, indent=2))
