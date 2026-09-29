#!/usr/bin/env python3
"""Connect this laptop to the hosted Music Space queue using outbound HTTPS."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent.parent
BASE_URL = os.environ.get("MUSIC_SPACE_WORKER_URL", "").rstrip("/")
TOKEN = os.environ.get("MUSIC_SPACE_BRIDGE_TOKEN", "")
if not TOKEN:
    local_secrets = ROOT / "cloudflare" / ".local-secrets.json"
    if local_secrets.exists():
        TOKEN = json.loads(local_secrets.read_text(encoding="utf-8"))["bridge_token"]
POLL_SECONDS = max(1, int(os.environ.get("MUSIC_SPACE_POLL_SECONDS", "10")))


def call(path, *, method="GET", body=None, content_type="application/json", timeout=30):
    data = body
    if isinstance(body, (dict, list)):
        data = json.dumps(body).encode()
    headers = {"Authorization": f"Bearer {TOKEN}", "User-Agent": "MusicSpaceBridge/1.0 (Mozilla/5.0)"}
    if content_type:
        headers["Content-Type"] = content_type
    request = Request(BASE_URL + path, data=data, headers=headers, method=method)
    with urlopen(request, timeout=timeout) as response:
        payload = response.read()
        return json.loads(payload) if payload else {}


def report_failure(job_id, error):
    message = str(error).strip() or "Generation failed. Check the laptop log."
    try:
        call(f"/api/bridge/jobs/{job_id}/fail", method="POST", body={"error": message[-1000:]})
    except Exception as report_error:
        print(f"Could not report job failure: {report_error}", file=sys.stderr)


def handle_plan(job, request_path, log_path):
    job_id = job["id"]
    score_path = ROOT / "outputs" / f"remote-{job_id}.abc"
    with log_path.open("w", encoding="utf-8") as log:
        result = subprocess.run(
            ["bash", str(ROOT / "scripts/plan.sh"), str(request_path), str(score_path)],
            cwd=ROOT,
            stdout=subprocess.DEVNULL,
            stderr=log,
            check=False,
        )
    if result.returncode:
        tail = log_path.read_text(encoding="utf-8", errors="replace")[-3000:]
        raise RuntimeError(f"Planning exited with status {result.returncode}. {tail}")
    if not score_path.exists():
        raise RuntimeError("Planning finished but no score file was found.")
    try:
        call(
            f"/api/bridge/jobs/{job_id}/score",
            method="PUT",
            body=score_path.read_text(encoding="utf-8").encode("utf-8"),
            content_type="text/plain; charset=utf-8",
            timeout=60,
        )
        print(f"Uploaded score for job {job_id}")
    finally:
        score_path.unlink(missing_ok=True)


def handle_generate(job, request_path, log_path):
    job_id = job["id"]
    output_dir = ROOT / "outputs"
    before = set(output_dir.glob("*.wav"))
    with log_path.open("w", encoding="utf-8") as log:
        result = subprocess.run(
            ["bash", str(ROOT / "scripts/generate.sh"), str(request_path)],
            cwd=ROOT,
            stdout=log,
            stderr=subprocess.STDOUT,
            check=False,
        )
    if result.returncode:
        tail = log_path.read_text(encoding="utf-8", errors="replace")[-3000:]
        raise RuntimeError(f"Generation exited with status {result.returncode}. {tail}")
    created = [path for path in output_dir.glob("*.wav") if path not in before and "-loop" not in path.stem]
    if not created:
        raise RuntimeError("Generation finished but no new WAV file was found.")
    audio_path = max(created, key=lambda path: path.stat().st_mtime_ns)
    call(
        f"/api/bridge/jobs/{job_id}/result",
        method="PUT",
        body=audio_path.read_bytes(),
        content_type="audio/wav",
        timeout=180,
    )
    print(f"Uploaded {audio_path.name} for job {job_id}")


def handle(job):
    job_id = job["id"]
    kind = job.get("kind", "generate")
    request_data = job["request"]
    output_dir = ROOT / "outputs"
    log_dir = ROOT / "logs"
    output_dir.mkdir(exist_ok=True)
    log_dir.mkdir(exist_ok=True)
    request_path = output_dir / f"remote-{job_id}.json"
    log_path = log_dir / f"remote-{job_id}.log"
    request_path.write_text(json.dumps(request_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Starting {kind} job {job_id}")
    try:
        if kind == "plan":
            handle_plan(job, request_path, log_path)
        else:
            handle_generate(job, request_path, log_path)
    except (OSError, URLError, HTTPError, RuntimeError, KeyError, ValueError) as error:
        report_failure(job_id, error)
        print(f"Job {job_id} failed: {error}", file=sys.stderr)
    finally:
        request_path.unlink(missing_ok=True)


def main():
    if not BASE_URL or not TOKEN:
        raise SystemExit("Set MUSIC_SPACE_WORKER_URL and MUSIC_SPACE_BRIDGE_TOKEN before starting the bridge.")
    if not BASE_URL.startswith("https://") and "localhost" not in BASE_URL and "127.0.0.1" not in BASE_URL:
        raise SystemExit("The hosted service URL must use HTTPS.")
    print(f"Music Space bridge connected to {BASE_URL}")
    while True:
        try:
            response = call("/api/bridge/claim", method="POST", body={}, timeout=20)
            job = response.get("job")
            if job:
                handle(job)
            else:
                time.sleep(POLL_SECONDS)
        except KeyboardInterrupt:
            print("Stopping Music Space bridge")
            return
        except (URLError, HTTPError, TimeoutError, json.JSONDecodeError) as error:
            print(f"Service connection issue: {error}; retrying in {POLL_SECONDS}s", file=sys.stderr)
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
