# Hosted phone prototype

The Cloudflare Worker serves a small phone-friendly request page. D1 stores the queue and request history. Workers KV keeps completed WAV files private. A bridge process on the laptop checks the queue over outbound HTTPS, runs the existing local generator, and uploads the audio. The laptop does not accept public inbound connections, and the generation server is not published.

The web app needs an always-on Cloudflare Worker endpoint. A laptop can only generate while it is powered on, connected, and running the bridge. It is fine to close the phone browser while a job runs and return later. When no job is waiting, the bridge checks for new work every 10 seconds by default; set `MUSIC_SPACE_POLL_SECONDS` to change that interval.

## Create the Cloudflare resources

Sign in to Wrangler. In WSL, the device login avoids the browser callback that the normal login uses:

```bash
npx wrangler login --device
```

Open the exact verification URL printed by Wrangler and enter its short code. Do not add the code to the link yourself. The code expires after five minutes.

If device authorization does not work, a scoped API token is an alternative. In the [Cloudflare API Tokens dashboard](https://dash.cloudflare.com/profile/api-tokens), choose **Create Token**, then **Create Custom Token**. Limit it to your account and give it **Workers Scripts: Edit**, **D1: Edit**, and **Workers KV Storage: Edit** permissions. Cloudflare shows the token only once.

In your own WSL terminal, save the token without putting it in chat or in your shell history:

```bash
bash scripts/save-cloudflare-token.sh
```

This writes an ignored file at `cloudflare/.auth.env`. Load that file if using a token. Set `CLOUDFLARE_ACCOUNT_ID` to the account ID shown in your Cloudflare dashboard. With a successful device login, skip the token file and account ID lines. From `cloudflare/`, create the resources:

```bash
source cloudflare/.auth.env
export CLOUDFLARE_ACCOUNT_ID="your-32-character-account-id"
cd cloudflare
npx wrangler d1 create music-space
npx wrangler kv namespace create AUDIO
```

Put the D1 `database_id` and KV namespace `id` from those commands into `wrangler.toml`. Apply the schema, create private credentials locally, deploy, and publish those credentials as Worker secrets:

```bash
npx wrangler d1 migrations apply music-space --remote
cd ..
python3 scripts/create-cloudflare-secrets.py
cd cloudflare
npx wrangler deploy
cd ..
python3 scripts/publish-cloudflare-secrets.py
```

The secrets file is ignored by Git and limited to your local user. To see the phone password on your laptop, run:

```bash
python3 -c 'import json; print(json.load(open("cloudflare/.local-secrets.json"))["app_password"])'
```

Keep the password and bridge token private. The bridge token is never sent to the browser. The Worker is initially locked because it has no secrets; it becomes usable after the publishing script completes.

Cloudflare gives the Worker a stable `workers.dev` address. A custom domain is optional. The Free plan is enough for an initial personal prototype, subject to Cloudflare's current quotas. The 10-second bridge poll uses about 8,640 Worker requests per day if left connected all day. Static page assets do not count toward that quota. KV audio storage is private and includes 1 GB on the Free plan, enough for about 150 35-second stereo WAV files at 48 kHz / 16-bit. A single KV value can be at most 25 MiB, so the page caps requests at 120 seconds. KV can take time to make a new audio file visible at every location, so a completed track may need a short retry before it plays. Add cleanup or use R2 later if the library outgrows this prototype.

## Connect the laptop

Keep the existing local prerequisites installed: built YuE2 binaries, the model files, and a working CUDA setup. In a WSL terminal, set the deployed Worker URL and bridge token for that terminal session, then start the connector:

```bash
export MUSIC_SPACE_WORKER_URL="https://your-worker.workers.dev"
bash scripts/remote-bridge.sh
```

Open the Worker URL on the phone, sign in with the locally saved app password, and submit a style, lyrics, and duration. The bridge reads its token from the private local file, polls every 10 seconds, generates on the laptop, and sends the WAV back to the hosted library. Leave the terminal running while you want remote generation to work. Stop the bridge with Ctrl+C.

Do not publish the bridge token or commit secrets. If one is exposed, replace it with `npx wrangler secret put BRIDGE_TOKEN` and restart the laptop bridge with the new value.

## Prototype limits

- The initial page is deliberately small. Product presets, prompt help, take comparison, retention settings, and desktop packaging are tracked in the root `future.md`.
- Generation requests are sequential because the local GPU and engine are configured for one song at a time.
- The first prototype stores one WAV artifact for each job. The laptop keeps its regular local output and log files as well.
- This personal prototype uses a shared password. Before inviting other users, replace that with proper individual sign-in, quotas, and retention controls.
- A laptop that sleeps or loses its network connection cannot take jobs until the bridge reconnects.
