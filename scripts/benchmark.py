#!/usr/bin/env python3
"""Run one generation and record wall time, GPU samples, and WAV properties."""
import array
import json
import math
from pathlib import Path
import subprocess
import sys
import time
import wave

root = Path(__file__).resolve().parent.parent
before = set((root / "outputs").glob("*.wav"))
samples = []
start = time.monotonic()
with (root / "logs" / "benchmark.log").open("w") as log:
    process = subprocess.Popen(
        ["bash", str(root / "scripts/generate.sh"), *sys.argv[1:]],
        cwd=root, stdout=log, stderr=subprocess.STDOUT,
    )
    while process.poll() is None:
        sample = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used,utilization.gpu", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10,
        )
        if sample.returncode == 0:
            used, utilization = map(int, sample.stdout.strip().splitlines()[0].split(","))
            samples.append({"seconds": round(time.monotonic() - start, 2),
                            "gpu_memory_mib": used, "gpu_utilization_percent": utilization})
        time.sleep(1)

report = {"exit_code": process.returncode, "elapsed_seconds": round(time.monotonic() - start, 2),
          "peak_sampled_total_gpu_memory_mib": max((s["gpu_memory_mib"] for s in samples), default=None),
          "gpu_samples": samples, "outputs": []}
for path in sorted(set((root / "outputs").glob("*.wav")) - before):
    with wave.open(str(path), "rb") as audio:
        info = {"path": str(path.relative_to(root)), "sample_rate": audio.getframerate(),
                "channels": audio.getnchannels(), "sample_width": audio.getsampwidth(),
                "duration_seconds": audio.getnframes() / audio.getframerate()}
        pcm = audio.readframes(audio.getnframes())
    if info["sample_width"] == 2:
        values = array.array("h", pcm)
        if sys.byteorder != "little":
            values.byteswap()
        info["peak_amplitude"] = max(map(abs, values), default=0) / 32768
        info["rms_amplitude"] = math.sqrt(sum(v*v for v in values) / max(len(values), 1)) / 32768
    report["outputs"].append(info)
(root / "outputs" / "benchmark.json").write_text(json.dumps(report, indent=2) + "\n")
if report['outputs']:
    audio_path = root / report['outputs'][0]['path']
    audio_path.with_suffix('.benchmark.json').write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({k: v for k, v in report.items() if k != "gpu_samples"}, indent=2))
raise SystemExit(process.returncode)
