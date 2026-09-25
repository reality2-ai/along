// Runs the live exchange inside Chromium: the page imports Along's current-R2
// modules over local HTTP and connects to the deployed hive itself. Usage:
// CHROMIUM_PATH=... node experiments/r2-current/browser-live-check.mjs [url] [evidence.json]
import {createServer} from 'node:http';
import {readFile, writeFile} from 'node:fs/promises';
import {extname, join, normalize} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';

const [url = 'wss://wairoa.mariko.org.nz/r2', out] = process.argv.slice(2);
const root = fileURLToPath(new URL('../../', import.meta.url));
const allowed = ['experiments/r2-current/', 'experiments/relay/transport.mjs', 'public/vendor/noble-ciphers/'];
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '');
  if (path === '') { res.writeHead(200, {'content-type': 'text/html'}); res.end('<!doctype html><title>r2</title>'); return; }
  if (!allowed.some(p => path.startsWith(p))) { res.writeHead(404); res.end(); return; }
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, {'content-type': extname(path) === '.mjs' || extname(path) === '.js' ? 'text/javascript' : 'text/plain'});
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined});
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async url => {
    const {runLiveExchange} = await import('/experiments/r2-current/live-exchange.mjs');
    return {runtime: navigator.userAgent, ...await runLiveExchange(url)};
  }, url);
  console.log(JSON.stringify(result, null, 2));
  if (out) await writeFile(out, JSON.stringify(result, null, 2) + '\n');
  process.exitCode = result.passed ? 0 : 1;
} finally { await browser.close(); server.close(); }
