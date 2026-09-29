// Smoke test of the melody check in the real page. Needs worker-harness.mjs
// and headless Chromium running (see browser.mjs). Writes a phone screenshot.
// Run: node cloudflare/test/smoke-melody-check.mjs <screenshot-dir>
import { readFileSync } from "node:fs";
import { connect } from "./browser.mjs";

const outDir = process.argv[2] || ".";
const page = await connect();
await page.open("http://127.0.0.1:8799/");
await page.login();
const state = () => page.run(`({ cards: [...document.querySelectorAll('#melody-check h4')].map(h => h.textContent), fixes: [...document.querySelectorAll('.check-fix')].map(b => b.textContent), ok: document.querySelector('.check-ok')?.textContent || null })`);
await page.set("#singing", "1"); await page.set("#duration", "20");
await page.set("#abc-score", readFileSync(new URL("./fixtures/hummed-7-notes-in-ins-00ba03db.abc", import.meta.url), "utf8"));
await page.wait(800);
console.log("tune in Ins:", JSON.stringify(await state()));
await page.run(`document.querySelector('#check-summary').click()`); await page.wait(500);
await page.shot(`${outDir}/melody-check-phone.png`, 390);
await page.run(`[...document.querySelectorAll('.check-fix')].find(b => b.textContent.startsWith('Use the instrument')).click()`); await page.wait(500);
console.log("after swap:", JSON.stringify(await state()));
console.log("page errors:", JSON.stringify(page.errors));
page.close();
if (page.errors.length) process.exit(1);
