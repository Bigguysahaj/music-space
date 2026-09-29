// Tiny Chrome DevTools Protocol driver (Node 22, no dependencies) for
// exercising the real page in headless Chromium. Start Chromium with
//   ~/.cache/ms-playwright/chromium-1140/chrome-linux/chrome --headless=new \
//     --no-sandbox --disable-gpu --hide-scrollbars --remote-debugging-port=9333 \
//     --user-data-dir=<scratch dir> about:blank
import { writeFileSync } from "node:fs";

export async function connect(port = 9333) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r, { once: true }));
  let seq = 0; const pending = new Map(); const errors = [];
  ws.addEventListener("message", e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map(a => a.value || a.description).join(" "));
  });
  const send = (method, params = {}) => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await send("Runtime.enable"); await send("Page.enable");
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const run = async expression => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
    return r.result.result.value;
  };
  // Sets a field's value and fires "input" the way typing would.
  const set = (selector, value) => run(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input')); })()`);
  // Viewport screenshot with `anchor` scrolled to the top; width < 600 emulates a phone.
  const shot = async (file, width, anchor = "#abc-score") => {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 1500, deviceScaleFactor: width < 600 ? 2 : 1, mobile: width < 600 });
    await wait(300);
    await run(`document.documentElement.style.scrollBehavior='auto'; document.querySelector(${JSON.stringify(anchor)}).scrollIntoView({block:'start'})`);
    await wait(2200);
    const reply = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(file, Buffer.from(reply.result.data, "base64"));
  };
  const open = async url => { await send("Page.navigate", { url }); await wait(1500); };
  const login = async (password = "userpw") => { await run(`document.querySelector('#password').value=${JSON.stringify(password)}; document.querySelector('#login-form').requestSubmit();`); await wait(1000); };
  return { send, run, set, shot, wait, open, login, errors, close: () => ws.close() };
}
