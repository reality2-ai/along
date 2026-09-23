// Preview and regular app share an origin but must not share persistence names.
// This is coexistence evidence, not same-origin script isolation.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join, extname} from 'node:path';
import {createHash} from 'node:crypto';
const {chromium, expect} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const root = new URL('../../releases/along-device-preview/', import.meta.url).pathname;
const regularRoot = new URL('../../dist/', import.meta.url).pathname;
const manifest = JSON.parse(await readFile(join(root, 'build-info.json'), 'utf8'));
assert.equal(manifest.profile, 'along-device-preview-v1');
assert.equal(manifest.appVersion, '3801');
const sources = new Map(await Promise.all(Object.entries(manifest.files).map(async ([name, hash]) => {
  const body = await readFile(join(root, name));
  assert.equal(createHash('sha256').update(body).digest('hex'), hash); return [name, body];
})));
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const preview = path.startsWith('/along/preview/');
  const prefix = preview ? '/along/preview/' : '/along/';
  const name = path.startsWith(prefix) ? path.slice(prefix.length) + (path.endsWith('/') ? 'index.html' : '') : '';
  try {
    const body = preview ? sources.get(name) : name && await readFile(join(regularRoot, name));
    if (!body) throw Error('missing');
    res.setHeader('Content-Type', ({'.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.css': 'text/css', '.gz': 'application/gzip', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml'})[extname(name)] || 'text/plain');
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const context = await browser.newContext();
  const normal = await context.newPage(), preview = await context.newPage();
  const origin = `http://127.0.0.1:${server.address().port}`, errors = [];
  for (const page of [normal, preview]) page.on('pageerror', error => errors.push(error.message));
  await normal.goto(origin + '/along/');
  await expect(normal.locator('#address-status')).toContainText('ready offline', {timeout: 60000});
  await expect.poll(() => normal.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(origin + '/along/sw.js');
  await normal.evaluate(async () => {
    localStorage.setItem('along-journeys-v1', JSON.stringify({learning: false, journeys: [], marker: 'regular saved preference sentinel'}));
    localStorage.setItem('along-feedback-v1', 'regular feedback sentinel');
    const {openBrowserStorage} = await import('./preview/experiments/tg-pairing/storage.mjs');
    const store = await openBrowserStorage('along-pairing-lab-v1');
    try { await store.compareAndSwapMany([{scope: 'preview-coexistence', key: 'sentinel', expectedRevision: 0, value: {kept: 'regular pairing lab'}}]); }
    finally { store.close(); }
  });
  const original = await normal.evaluate(async () => {
    const cache = await caches.open('along-shell-v37'), entries = [];
    for (const request of await cache.keys()) {
      const bytes = await (await cache.match(request)).arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
      entries.push([request.url, hash]);
    }
    return {preferences: localStorage.getItem('along-journeys-v1'), feedback: localStorage.getItem('along-feedback-v1'), cache: entries};
  });
  await preview.addInitScript(() => {
    window.previewStorageAccess = [];
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function(name, ...args) { window.previewStorageAccess.push(['database', name]); return open.call(this, name, ...args); };
    for (const method of ['getItem', 'setItem', 'removeItem']) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function(key, ...args) { window.previewStorageAccess.push([method, key]); return original.call(this, key, ...args); };
    }
  });
  await preview.goto(origin + '/along/preview/public/');
  await expect(preview.locator('#address-status')).toContainText('ready offline', {timeout: 60000});
  await expect.poll(() => preview.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(origin + '/along/preview/public/sw.js');
  await preview.locator('#settings-open').click();
  await expect(preview.locator('#settings')).toContainText('App version 3801');
  await preview.getByRole('button', {name: 'Device and AT-key setup', exact: true}).click();
  await preview.getByRole('button', {name: 'Set up my device', exact: true}).click();
  await preview.getByRole('button', {name: 'Create my device group', exact: true}).click();
  await preview.getByRole('heading', {name: 'Your devices and AT key', exact: true}).waitFor();
  const accesses = await preview.evaluate(() => window.previewStorageAccess);
  assert.ok(accesses.some(([kind, name]) => kind === 'database' && name === 'r2-browser:' + manifest.namespaces.devices));
  assert.ok(accesses.some(([kind, name]) => kind === 'getItem' && name === manifest.namespaces.preferences));
  for (const [kind, name] of accesses) assert.ok(name.startsWith(kind === 'database' ? 'r2-browser:along-device-preview-' : 'along-device-preview-'), `Unexpected persistence access: ${kind} ${name}`);
  // The worker opens its own timetable database, outside the window hook.
  const databases = await preview.evaluate(() => indexedDB.databases());
  assert.ok(databases.some(db => db.name === manifest.namespaces.offline));
  assert.ok(databases.some(db => db.name === 'along-offline'));
  await preview.goto(origin + '/along/preview/public/update.html');
  await preview.locator('#recover-update').click();
  await expect(preview.locator('#recovery-status')).toContainText('3801', {timeout: 60000});
  await preview.locator('#recover-update').click();
  await expect(preview.locator('#address-status')).toContainText('ready offline', {timeout: 60000});
  await context.setOffline(true);
  await Promise.all([normal.reload(), preview.reload()]);
  await expect(normal.locator('#address-status')).toContainText('ready offline', {timeout: 60000});
  await expect(preview.locator('#address-status')).toContainText('ready offline', {timeout: 60000});
  const after = await normal.evaluate(async () => {
    const cache = await caches.open('along-shell-v37'), entries = [];
    for (const request of await cache.keys()) {
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await (await cache.match(request)).arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('');
      entries.push([request.url, hash]);
    }
    return {preferences: localStorage.getItem('along-journeys-v1'), feedback: localStorage.getItem('along-feedback-v1'), cache: entries};
  });
  const sentinel = await preview.evaluate(async () => {
    const {openBrowserStorage} = await import('../experiments/tg-pairing/storage.mjs');
    const store = await openBrowserStorage('along-pairing-lab-v1');
    try { return await store.read('preview-coexistence', 'sentinel'); }
    finally { store.close(); }
  });
  assert.deepEqual(after, original); assert.deepEqual(sentinel, {revision: 1, value: {kept: 'regular pairing lab'}});
  assert.deepEqual(errors, []);
  console.log('PASS: regular and preview app coexist on one origin; preview setup, update/reopen and offline reopening preserve regular preferences, feedback, pairing record and byte-identical shell cache. Namespacing is not a same-origin security boundary.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
