CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'complete', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  request_json TEXT NOT NULL,
  audio_key TEXT,
  audio_name TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS jobs_status_created ON jobs(status, created_at);
CREATE INDEX IF NOT EXISTS jobs_created ON jobs(created_at DESC);
