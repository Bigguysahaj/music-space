// Serves the real Worker (src/index.js) and public/ on http://127.0.0.1:8799
// with D1 -> in-memory node:sqlite and KV -> a Map. No wrangler, no network.
// Run: node cloudflare/test/worker-harness.mjs   (user password "userpw",
// bridge token "bridgetok"; point the bridge at it with
// MUSIC_SPACE_WORKER_URL=http://127.0.0.1:8799 MUSIC_SPACE_BRIDGE_TOKEN=bridgetok)
import http from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const worker = (await import(`${root}/src/index.js`)).default;
const db = new DatabaseSync(":memory:");
for (const file of readdirSync(`${root}/migrations`).sort()) db.exec(readFileSync(`${root}/migrations/${file}`, "utf8"));
const DB = { prepare(sql) { let args = []; const st = db.prepare(sql); const o = {
  bind(...a) { args = a; return o; },
  async first() { return st.get(...args) ?? null; },
  async all() { return { results: st.all(...args) }; },
  async run() { const r = st.run(...args); return { meta: { changes: r.changes } }; } }; return o; } };
const kv = new Map();
const AUDIO = { async put(k, v) { kv.set(k, Buffer.from(v)); }, async get(k) { const v = kv.get(k); return v ? new Blob([v]).stream() : null; } };
const types = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".html": "text/html" };
const ASSETS = { fetch(req) {
  const file = new URL(req.url).pathname === "/" ? "/index.html" : new URL(req.url).pathname;
  try { return new Response(readFileSync(`${root}/public${file}`), { headers: { "content-type": types[path.extname(file)] || "application/octet-stream" } }); }
  catch { return new Response("Not found", { status: 404 }); }
} };
const env = { DB, AUDIO, ASSETS, APP_PASSWORD: "userpw", BRIDGE_TOKEN: "bridgetok" };
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks);
  const r = await worker.fetch(new Request(`http://127.0.0.1:8799${req.url}`, { method: req.method, headers: req.headers, body }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(8799, () => console.log("harness up on http://127.0.0.1:8799"));
