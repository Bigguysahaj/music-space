# Serve Raag while keeping Porkbun DNS

Recommendation: use this tiny Cloudflare Pages gateway in the **same Cloudflare account** as `music-space`. Every request goes through the `APP` service binding to that existing Worker. It serves both the UI and backend. No data migration, duplicated secrets, frontend/backend split, or public HTTP proxy is needed.

## Repository findings

- Hosted frontend: plain HTML, CSS, SVG and inline JavaScript in `cloudflare/public/`; no React, Next.js, Vite, npm build or frontend package manifest.
- Hosted backend: ES-module Worker `cloudflare/src/index.js`, configured by `cloudflare/wrangler.toml`. Its `ASSETS` binding serves `public`; `/api/*` runs the Worker first.
- Existing bindings: D1 `DB` = `music-space` (`272d73f8-08f9-474e-a80c-e6c6fe7ce91a`); KV `AUDIO` = `a2cee1ddb41848da95b5ffcd9746b7f5`; Worker secrets `APP_PASSWORD` and `BRIDGE_TOKEN`.
- Routes cover login, job creation/list/detail, authenticated audio downloads, and bridge claim/source/result/score/failure. The working tree also includes multipart transcription uploads, with a 25 MiB audio cap. The gateway streams requests/responses without parsing them.
- The browser uses relative `/api/` URLs and bearer authentication, so it works at the new origin without CORS or cookie-domain changes. Sign in again on the new origin.
- `scripts/build.sh` builds local CUDA/C++ generation, planning and transcription binaries; it is not a hosting build command. `scripts/remote-bridge.py` polls over outbound HTTPS and runs those binaries on the laptop. Leave its existing Worker URL and credentials in place.
- There are pre-existing uncommitted application changes. This gateway exposes the **currently deployed Worker**, not those local changes. Deploying the gateway does not deploy the transcription work or run database migrations.

## Why this approach

A normal Worker Custom Domain requires an active Cloudflare zone. Adding it to a pending full zone does not activate it while Porkbun remains authoritative; a CNAME to `workers.dev` is not a substitute. Cloudflare offers paid Business/Enterprise partial-zone setups for external authoritative DNS, but that is unnecessary here.

Pages supports subdomains with external DNS and a CNAME. It can also host the full application using an advanced-mode `_worker.js`, D1/KV bindings and copied secrets. That is feasible with little code change, but creates a second app deployment and requires managing its bindings, secrets and releases. This gateway instead calls the single existing deployment.

Vercel could proxy the whole app using an external catch-all rewrite to the Worker. Moving the backend into Vercel Functions is not a drop-in move: its Cloudflare bindings need replacement or remote adapters. A Vercel proxy also introduces cross-provider traffic and its external-proxy timeout (120 seconds); large audio transfers need validation. Asynchronous GPU generation itself does not hold an HTTP request open. Pages service bindings avoid that extra provider.

Tradeoff: one extra Pages project remains necessary. All traffic through this hostname, including static assets, invokes a Pages Function and is subject to Workers/Pages Functions usage quotas. The existing Worker, storage and laptop remain dependencies.

## Deploy when ready

Use a Cloudflare login/token for the same account as the Worker, with permission to deploy Pages. The existing narrowly scoped Worker token may not include Pages permissions. Do not put credentials in these files.

From the repository root:

```bash
cd pages-gateway
npx wrangler pages project create raag-tanishidevlal --production-branch main
npx wrangler pages deploy public --project-name raag-tanishidevlal --branch main
```

This is a separate Direct Upload project. There is no build command. Its output directory is `public`; Wrangler reads this directory's `wrangler.toml`, including `APP -> music-space`. Do not run `wrangler deploy` here, do not upload the repository root, and do not use the existing Worker's Wrangler config for Pages.

Record the actual production `*.pages.dev` hostname printed by Cloudflare. The intended hostname is `raag-tanishidevlal.pages.dev`, but availability is not reserved by this preparation; if Cloudflare assigns a different hostname, use that exact hostname below.

1. Test the production Pages URL: page/CSS load, sign-in, existing library and audio download. With the laptop bridge running, test a small generation and score job. Test transcription only if it is already deployed on the origin Worker. These actions use the real existing data.
2. In the `music-space` Worker, remove **only** the pending Custom Domain association for `raag.tanishidevlal.com` before assigning that same hostname to Pages. Keep the Worker and its `workers.dev` endpoint. Do not delete the deployment, Cloudflare zone, D1, KV, or any other domain. This preparation has not removed the association.
3. In **Workers & Pages > raag-tanishidevlal > Custom domains > Set up a custom domain**, enter `raag.tanishidevlal.com`. Follow the external-DNS setup. Associate the hostname here before creating the CNAME; DNS alone is insufficient.
4. In Porkbun **Domain Management > tanishidevlal.com > DNS**, add the following record (or replace a conflicting record at **raag only**):

| Field | Value |
| --- | --- |
| Type | `CNAME` |
| Host | `raag` |
| Answer / Value | `raag-tanishidevlal.pages.dev` (use the actual production hostname from step 1 if different) |
| TTL | `600` seconds |

Use no `https://` and no path in the Answer. Keep Porkbun nameservers and every other record, including `jaap` and `run`, unchanged. Do not point this record to `workers.dev`, a preview deployment hostname, or Vercel.

5. Wait for Pages to report the custom domain active and HTTPS certificate issued. Verify `https://raag.tanishidevlal.com/` and repeat the login/library/audio check. Leave the bridge pointed at its existing URL; both hostnames reach the same jobs and files.

If Pages attempts automatic DNS setup in the pending Cloudflare zone, the record must still be added at authoritative Porkbun. If activation fails, inspect the domain's specific validation error before making any other DNS changes.

## Validation and rollback

Preparation checks: Wrangler 4.143.0 compiled the gateway and accepted its service binding configuration, but its local multi-Worker runtime exited with `EPIPE`. A Node integration check calling the actual Worker through the gateway passed HTML/CSS serving, login, rejected unauthorized access, job listing, 25 MiB bridge upload/download, and multipart transcription upload. D1/KV were mocked; no production data was changed. Live Cloudflare routing and storage still need the acceptance checks above.

Local forwarding checks do not prove public DNS or certificate issuance. Live acceptance requires the Pages deployment and custom-domain steps above. To undo the rollout, restore only the previous `raag` DNS record (or remove the new record if none existed), then detach the Pages custom domain. The original Worker URL continues to work.

## Official references checked 2026-09-29

- [Worker Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Partial-zone availability](https://developers.cloudflare.com/dns/zone-setups/partial-setup/)
- [Pages external-DNS custom subdomains](https://developers.cloudflare.com/pages/configuration/custom-domains/)
- [Pages service bindings and D1/KV bindings](https://developers.cloudflare.com/pages/functions/bindings/)
- [Pages advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/)
- [Pages Wrangler configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)
- [Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)
- [Pages Functions usage](https://developers.cloudflare.com/pages/functions/pricing/)
- [Vercel external rewrites](https://vercel.com/docs/routing/rewrites)
- [Vercel limits](https://vercel.com/docs/limits)
