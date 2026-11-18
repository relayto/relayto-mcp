// page-qa.mjs: check a published RELAYTO web content in headless Chrome, as a visitor sees it.
// Usage: node page-qa.mjs <page url> <outDir> [--links N] [--wait 12]
// Writes to <outDir>:
//   desktop-00.png …  the page at 1440x900, one screenshot per screen of the viewer's scroll box
//   mobile-00.png …   the same at 390x844
//   desktop-chat.png  the first screen after --wait seconds (the proactive chat bubble)
//   report.json       console errors, failed requests, fonts the page uses vs. fonts loaded,
//                     iframes (e.g. a share-price widget), internal links and where the first N land
// Chrome: $CHROME, else the usual macOS / Linux locations. A throwaway profile, removed at the end.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const url = args[0], out = args[1];
if (!url || !out) { console.error('usage: node page-qa.mjs <url> <outDir> [--links N] [--wait S]'); process.exit(2); }
const opt = (name, d) => { const i = args.indexOf(name); return i > 0 ? Number(args[i + 1]) : d; };
const linkCount = opt('--links', 4), waitChat = opt('--wait', 12);
mkdirSync(out, { recursive: true });
const chrome = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  .find((p) => p && existsSync(p));
if (!chrome) { console.error('No Chrome found; set CHROME=/path/to/chrome'); process.exit(2); }
const profile = mkdtempSync(join(tmpdir(), 'page-qa-'));
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', `--user-data-dir=${profile}`, '--remote-debugging-port=0',
  '--hide-scrollbars', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let port;
for (let i = 0; i < 100 && !port; i++) {
  const f = join(profile, 'DevToolsActivePort');
  if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0];
  if (!port) await sleep(200);
}
const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const events = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method) events.push(m);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
const shot = async (file) => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, file), Buffer.from(s.result.data, 'base64')); };

// Finds the page's shadow root and the box it scrolls in, wherever the viewer put them.
const FIND = `(() => {
  const walk = (root) => { for (const el of root.querySelectorAll('*')) { if (el.shadowRoot && el.shadowRoot.querySelector('[data-rt-body],body,main,section')) return el.shadowRoot; if (el.shadowRoot) { const r = walk(el.shadowRoot); if (r) return r; } } return null; };
  window.__qaRoot = walk(document);
  let box = window.__qaRoot && window.__qaRoot.host;
  while (box && box !== document.body) { const s = getComputedStyle(box); if (/(auto|scroll)/.test(s.overflowY) && box.scrollHeight > box.clientHeight + 4) break; box = box.parentElement; }
  window.__qaBox = box && box !== document.body ? box : document.scrollingElement;
  return !!window.__qaRoot;
})()`;

async function load(width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  await send('Page.navigate', { url });
  await sleep(9000);
  return evaluate(FIND);
}
async function screens(prefix) {
  const total = await evaluate('(() => { const b = window.__qaBox; return Math.ceil(b.scrollHeight / b.clientHeight); })()');
  for (let i = 0; i < Math.min(total, 30); i++) {
    await evaluate(`(() => { const b = window.__qaBox; b.scrollTop = ${i} * b.clientHeight; return true; })()`);
    await sleep(900);
    await shot(`${prefix}-${String(i).padStart(2, '0')}.png`);
  }
  await evaluate('(() => { window.__qaBox.scrollTop = 0; return true; })()');
  return total;
}

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Log.enable');
const report = { url, found: false };
report.found = await load(1440, 900, false);
report.desktopScreens = await screens('desktop');
report.fonts = await evaluate(`(() => {
  const r = window.__qaRoot; if (!r) return null;
  const used = new Set(); r.querySelectorAll('*').forEach((el) => { const f = getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim(); if (f) used.add(f); });
  const loaded = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, '') + ' ' + f.weight);
  const failed = [...document.fonts].filter((f) => f.status === 'error').map((f) => f.family.replace(/["']/g, '') + ' ' + f.weight);
  return { usedFirstChoice: [...used], loaded, failed };
})()`);
report.iframes = await evaluate(`(() => { const r = window.__qaRoot; return r ? [...r.querySelectorAll('iframe')].map((f) => ({ src: f.src.slice(0, 120), w: f.clientWidth, h: f.clientHeight })) : []; })()`);
report.links = await evaluate(`(() => { const r = window.__qaRoot; if (!r) return []; return [...new Set([...r.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute('href')))]; })()`);
await sleep(Math.max(0, waitChat * 1000 - 9000));
await shot('desktop-chat.png');

// Where do the first N internal links land (the viewer should show the document on the asked page)?
report.linkChecks = [];
for (const href of (report.links || []).filter((h) => h.startsWith('/e/')).slice(0, linkCount)) {
  await send('Page.navigate', { url: new URL(href, url).href });
  await sleep(8000);
  const landed = await evaluate('location.pathname + location.search');
  const n = report.linkChecks.length;
  await shot(`link-${n}.png`);
  report.linkChecks.push({ href, landed, screenshot: `link-${n}.png` });
}

await load(390, 844, true);
report.mobileScreens = await screens('mobile');

report.consoleErrors = events.filter((e) => (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') || e.method === 'Runtime.exceptionThrown')
  .map((e) => e.params.exceptionDetails ? (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text) : e.params.args.map((a) => a.value || a.description).join(' ')).slice(0, 40);
report.logErrors = events.filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error').map((e) => `${e.params.entry.text} ${e.params.entry.url || ''}`).slice(0, 40);
report.failedRequests = events.filter((e) => e.method === 'Network.loadingFailed' && !e.params.canceled).map((e) => e.params.errorText).slice(0, 40);
const status = new Map();
events.filter((e) => e.method === 'Network.responseReceived').forEach((e) => { if (e.params.response.status >= 400) status.set(e.params.response.url, e.params.response.status); });
report.httpErrors = [...status].map(([u, s]) => `${s} ${u}`).slice(0, 40);
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
ws.close(); proc.kill(); await Promise.race([new Promise((r) => proc.on('exit', r)), sleep(5000)]);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
console.log(JSON.stringify({ found: report.found, desktopScreens: report.desktopScreens, mobileScreens: report.mobileScreens, consoleErrors: report.consoleErrors.length, httpErrors: report.httpErrors.length, linkChecks: report.linkChecks.length }));
process.exit(0);
