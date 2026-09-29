const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

function constantTimeEqual(a, b) {
  const left = new TextEncoder().encode(a || "");
  const right = new TextEncoder().encode(b || "");
  let difference = left.length ^ right.length;
  const count = Math.max(left.length, right.length);
  for (let i = 0; i < count; i++) difference |= (left[i] || 0) ^ (right[i] || 0);
  return difference === 0;
}

function bearer(request) {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function requireUser(request, env) {
  return Boolean(env.APP_PASSWORD) && constantTimeEqual(bearer(request), env.APP_PASSWORD);
}

function requireBridge(request, env) {
  return Boolean(env.BRIDGE_TOKEN) && constantTimeEqual(bearer(request), env.BRIDGE_TOKEN);
}

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

function safeJob(row) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    request: JSON.parse(row.request_json),
    audioName: row.audio_name,
    resultText: row.result_text,
    error: row.error,
  };
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/login" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    return json({ ok: Boolean(env.APP_PASSWORD) && constantTimeEqual(body.password, env.APP_PASSWORD) });
  }

  if (path.startsWith("/api/bridge/")) {
    if (!requireBridge(request, env)) return json({ error: "Unauthorized" }, 401);

    if (path === "/api/bridge/claim" && method === "POST") {
      const staleBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      await env.DB.prepare(
        "UPDATE jobs SET status = 'queued', updated_at = ? WHERE status = 'running' AND updated_at < ?",
      ).bind(new Date().toISOString(), staleBefore).run();
      const row = await env.DB.prepare(
        "SELECT id, kind, request_json FROM jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1",
      ).first();
      if (!row) return json({ job: null });
      const now = new Date().toISOString();
      const claimed = await env.DB.prepare(
        "UPDATE jobs SET status = 'running', updated_at = ? WHERE id = ? AND status = 'queued'",
      ).bind(now, row.id).run();
      if (!claimed.meta.changes) return json({ job: null });
      return json({ job: { id: row.id, kind: row.kind, request: JSON.parse(row.request_json) } });
    }

    // Transcribe jobs carry reference audio uploaded by the phone. The bridge
    // fetches it through this bridge-authed proxy rather than a field in the
    // claim response, so claim stays JSON-only.
    const sourceMatch = path.match(/^\/api\/bridge\/jobs\/([0-9a-f-]+)\/source$/i);
    if (sourceMatch && method === "GET") {
      const row = await env.DB.prepare("SELECT status, kind, source_audio_key FROM jobs WHERE id = ?").bind(sourceMatch[1]).first();
      if (!row || row.status !== "running") return json({ error: "Job is not running" }, 409);
      if (row.kind !== "transcribe" || !row.source_audio_key) return json({ error: "This job has no source audio" }, 400);
      const audio = await env.AUDIO.get(row.source_audio_key, "stream");
      if (!audio) return json({ error: "Source audio is still being distributed; try again shortly" }, 404);
      return new Response(audio, { headers: { "content-type": "audio/wav", "cache-control": "no-store" } });
    }

    const resultMatch = path.match(/^\/api\/bridge\/jobs\/([0-9a-f-]+)\/result$/i);
    if (resultMatch && method === "PUT") {
      const id = resultMatch[1];
      const row = await env.DB.prepare("SELECT status, kind FROM jobs WHERE id = ?").bind(id).first();
      if (!row || row.status !== "running") return json({ error: "Job is not running" }, 409);
      if (row.kind === "plan" || row.kind === "transcribe") return json({ error: "This job expects a score, not audio" }, 400);
      const bytes = await request.arrayBuffer();
      if (!bytes.byteLength || bytes.byteLength > MAX_AUDIO_BYTES) return json({ error: "Audio must be between 1 byte and 25 MiB" }, 413);
      const name = (request.headers.get("x-audio-name") || "generated.wav").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
      const key = `jobs/${id}/${name}`;
      await env.AUDIO.put(key, bytes);
      await env.DB.prepare(
        "UPDATE jobs SET status = 'complete', updated_at = ?, audio_key = ?, audio_name = ? WHERE id = ? AND status = 'running'",
      ).bind(new Date().toISOString(), key, name, id).run();
      return json({ ok: true, audioName: name });
    }

    const scoreMatch = path.match(/^\/api\/bridge\/jobs\/([0-9a-f-]+)\/score$/i);
    if (scoreMatch && method === "PUT") {
      const id = scoreMatch[1];
      const row = await env.DB.prepare("SELECT status, kind FROM jobs WHERE id = ?").bind(id).first();
      if (!row || row.status !== "running") return json({ error: "Job is not running" }, 409);
      if (row.kind !== "plan" && row.kind !== "transcribe") return json({ error: "This job expects audio, not a score" }, 400);
      const text = await request.text();
      if (!text.trim() || text.length > 200000) return json({ error: "Score must be non-empty and under 200,000 characters" }, 413);
      await env.DB.prepare(
        "UPDATE jobs SET status = 'complete', updated_at = ?, result_text = ? WHERE id = ? AND status = 'running'",
      ).bind(new Date().toISOString(), text, id).run();
      return json({ ok: true });
    }

    const failMatch = path.match(/^\/api\/bridge\/jobs\/([0-9a-f-]+)\/fail$/i);
    if (failMatch && method === "POST") {
      const id = failMatch[1];
      const body = await request.json().catch(() => ({}));
      const message = String(body.error || "Generation failed").slice(0, 1000);
      await env.DB.prepare(
        "UPDATE jobs SET status = 'failed', updated_at = ?, error = ? WHERE id = ? AND status = 'running'",
      ).bind(new Date().toISOString(), message, id).run();
      return json({ ok: true });
    }
    return json({ error: "Not found" }, 404);
  }

  if (!requireUser(request, env)) return json({ error: "Unauthorized" }, 401);

  // Transcribe jobs are created in one multipart request (a JSON "meta" part
  // plus an "audio" part) rather than POST + a separate audio PUT, so a job
  // never exists in the queue without its source audio.
  if (path === "/api/jobs" && method === "POST" && (request.headers.get("content-type") || "").startsWith("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) return json({ error: "Could not read the upload" }, 400);
    let meta;
    try { meta = JSON.parse(form.get("meta") || "{}"); } catch { return json({ error: "meta must be JSON" }, 400); }
    if (meta?.kind !== "transcribe") return json({ error: "Only transcribe jobs accept an audio upload" }, 400);
    const options = meta.request ?? {};
    if (typeof options !== "object" || Array.isArray(options)) return json({ error: "Provide a request object" }, 400);
    if (options.melody_only !== undefined && typeof options.melody_only !== "boolean") return json({ error: "melody_only must be true or false" }, 400);
    const audio = form.get("audio");
    if (!audio || typeof audio === "string") return json({ error: "Attach an audio file" }, 400);
    const bytes = await audio.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_AUDIO_BYTES) return json({ error: "Audio must be between 1 byte and 25 MiB" }, 413);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const key = `jobs/${id}/source.wav`;
    await env.AUDIO.put(key, bytes);
    await env.DB.prepare(
      "INSERT INTO jobs (id, kind, status, created_at, updated_at, request_json, source_audio_key) VALUES (?, 'transcribe', 'queued', ?, ?, ?, ?)",
    ).bind(id, now, now, JSON.stringify({ melody_only: options.melody_only ?? true }), key).run();
    return json({ id, status: "queued" }, 201);
  }

  if (path === "/api/jobs" && method === "POST") {
    const body = await request.json().catch(() => null);
    const musicRequest = body?.request;
    const kind = body?.kind === "plan" ? "plan" : "generate";
    if (!musicRequest || typeof musicRequest !== "object" || Array.isArray(musicRequest)) return json({ error: "Provide a request object" }, 400);
    if (typeof musicRequest.style !== "string" || !musicRequest.style.trim() || musicRequest.style.length > 4000) return json({ error: "Style is required and must be under 4,000 characters" }, 400);
    if (typeof musicRequest.lyrics !== "string" || !musicRequest.lyrics.trim() || musicRequest.lyrics.length > 12000) return json({ error: "Lyrics are required and must be under 12,000 characters" }, 400);
    const duration = Number(musicRequest.duration || 20);
    if (!Number.isFinite(duration) || duration < 5 || duration > 120) return json({ error: "Duration must be between 5 and 120 seconds" }, 400);
    musicRequest.duration = duration;
    if (musicRequest.abc !== undefined && (typeof musicRequest.abc !== "string" || musicRequest.abc.length > 200000)) return json({ error: "Score must be a string under 200,000 characters" }, 400);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO jobs (id, kind, status, created_at, updated_at, request_json) VALUES (?, ?, 'queued', ?, ?, ?)",
    ).bind(id, kind, now, now, JSON.stringify(musicRequest)).run();
    return json({ id, status: "queued" }, 201);
  }

  if (path === "/api/jobs" && method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id, kind, status, created_at, updated_at, request_json, audio_name, result_text, error FROM jobs ORDER BY created_at DESC LIMIT 50",
    ).all();
    return json({ jobs: rows.results.map(safeJob) });
  }

  const audioMatch = path.match(/^\/api\/jobs\/([0-9a-f-]+)\/audio$/i);
  if (audioMatch && method === "GET") {
    const row = await env.DB.prepare("SELECT status, audio_key, audio_name FROM jobs WHERE id = ?").bind(audioMatch[1]).first();
    if (!row || row.status !== "complete" || !row.audio_key) return json({ error: "Audio not ready" }, 404);
    const audio = await env.AUDIO.get(row.audio_key, "stream");
    if (!audio) return json({ error: "Audio is still being distributed; try again shortly" }, 404);
    return new Response(audio, {
      headers: {
        "content-type": "audio/wav",
        "content-disposition": `inline; filename="${row.audio_name}"`,
        "cache-control": "private, no-store",
      },
    });
  }

  const jobMatch = path.match(/^\/api\/jobs\/([0-9a-f-]+)$/i);
  if (jobMatch && method === "GET") {
    const row = await env.DB.prepare(
      "SELECT id, kind, status, created_at, updated_at, request_json, audio_name, result_text, error FROM jobs WHERE id = ?",
    ).bind(jobMatch[1]).first();
    return row ? json(safeJob(row)) : json({ error: "Job not found" }, 404);
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname.startsWith("/api/")) {
      try {
        return await route(request, env);
      } catch (error) {
        console.error("API request failed", error);
        return json({ error: "The service could not complete this request" }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
