// Smoke test of the fit editor in the real page: open it from the Melody
// check card, stretch a syllable with a real pointer drag, apply, and check
// the Melody check goes green. Needs worker-harness.mjs and headless Chromium
// (see browser.mjs). Writes phone and desktop screenshots.
// Run: node cloudflare/test/smoke-fit-editor.mjs <screenshot-dir>
import { readFileSync } from "node:fs";
import { connect } from "./browser.mjs";

const outDir = process.argv[2] || ".";
const page = await connect();
const tune = await import("../public/assets/melody-check.js").then(m => (m.default || m).swapVocalAndInstrument(readFileSync(new URL("./fixtures/hummed-tune-in-ins-1ddc5f64.abc", import.meta.url), "utf8")));
await page.open("http://127.0.0.1:8799/");
await page.login();
await page.run(`localStorage.removeItem('fit-editor-coach')`);
await page.set("#singing", "1"); await page.set("#duration", "30");
await page.set("#lyrics", "[Verse]\nOm Krishnaaya Vaasudevaaya\nHaraye Paramaatmane\nPranatah Klesha Naashaaya\nGovindaaya Namo Namah");
await page.set("#abc-score", tune);
await page.wait(800);
const cards = () => page.run(`[...document.querySelectorAll('#melody-check h4, #melody-check .check-ok')].map(n => n.textContent)`);
console.log("before:", JSON.stringify(await cards()));
await page.run(`for (let n = document.querySelector('#melody-check'); n; n = n.parentElement) if (n.tagName === 'DETAILS') n.open = true; [...document.querySelectorAll('.check-fit')][0].click()`);
await page.wait(600);
const lanes = () => page.run(`[...document.querySelectorAll('.fit-lane-title strong')].map(n => n.textContent)`);
console.log("lanes:", JSON.stringify(await lanes()));
await page.shot(`${outDir}/fit-editor-phone.png`, 390, "#fit-editor-host");
await page.shot(`${outDir}/fit-editor-desktop.png`, 1280, "#fit-editor-host");
// Stretch the first syllable of line 1 by dragging its grip over the next notes.
const grip = await page.run(`(() => { const r = document.querySelector('.fit-chip[data-phrase="0"][data-group="0"] .fit-grip').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const mouse = (type, x, y) => page.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
await mouse("mousePressed", grip.x, grip.y);
for (let i = 1; i <= 8; i++) await mouse("mouseMoved", grip.x + i * 12, grip.y);
await mouse("mouseReleased", grip.x + 96, grip.y);
await page.wait(300);
console.log("after drag:", JSON.stringify(await lanes()));
// Tie the repeats, fit every line, keep the suggestion, open notation, apply.
await page.run(`[...document.querySelectorAll('.fit-toolbar button')].find(b => b.textContent.startsWith('Fit all')).click()`); await page.wait(300);
console.log("suggested:", JSON.stringify(await lanes()));
await page.shot(`${outDir}/fit-editor-suggestion-phone.png`, 390, ".fit-pending");
await page.run(`[...document.querySelectorAll('.fit-pending button')].find(b => b.textContent === 'Keep it').click()`); await page.wait(300);
await page.run(`document.querySelector('.fit-staff-box summary').click()`); await page.wait(300);
await page.shot(`${outDir}/fit-editor-notation-phone.png`, 390, ".fit-staff-box");
await page.shot(`${outDir}/fit-editor-notation-desktop.png`, 1280, ".fit-staff-box");
console.log("pageScrollsSideways:", await page.run(`document.documentElement.scrollWidth > document.documentElement.clientWidth`));
await page.run(`document.querySelector('.fit-apply').click()`); await page.wait(900);
console.log("after apply:", JSON.stringify(await cards()));
console.log("score:", (await page.run(`document.querySelector('#abc-score').value`)).split("% verse")[1].split("\n").filter(l => /^[(a-g]/.test(l)).join("  "));
// Listen: the karaoke highlight moves over the first syllable, and Stop clears it.
await page.run(`document.querySelector('.fit-play').click()`); await page.wait(400);
console.log("listening highlight:", await page.run(`document.querySelectorAll('.fit-editor .playing').length > 0`));
await page.run(`document.querySelector('.fit-play').click()`); await page.wait(200);
console.log("stopped:", await page.run(`document.querySelectorAll('.fit-editor .playing').length === 0`));
console.log("page errors:", JSON.stringify(page.errors));
page.close();
if (page.errors.length) process.exit(1);
