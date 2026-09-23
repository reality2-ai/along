// Actual generated journey app on a static subpath, with a real local software
// identity/vault and mocked provider. No production key or proxy is involved.
import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join, extname} from 'node:path';
const {chromium, expect} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const root = new URL('../../releases/along-experimental-app/', import.meta.url).pathname;
const manifest = JSON.parse(await readFile(join(root, 'build-info.json'), 'utf8'));
assert.equal(manifest.profile, 'along-experimental-app-v1');
assert.equal(Object.keys(manifest.files).some(name => /APIKey|\.test\./.test(name)), false);
const sources = new Map(await Promise.all(Object.entries(manifest.files).map(async ([name, hash]) => {
  const bytes = await readFile(join(root, name));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hash); return [name, bytes];
})));
const prefix = '/along-exp/';
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const name = path.startsWith(prefix) ? path.slice(prefix.length) + (path.endsWith('/') ? 'index.html' : '') : '';
  const body = sources.get(name);
  if (!body) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', ({'.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.css': 'text/css', '.gz': 'application/gzip', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml'})[extname(name)] || 'text/plain');
  res.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH,
    ...(process.env.CHECK_BFCACHE === '1' ? {ignoreDefaultArgs: ['--disable-back-forward-cache']} : {})});
  const context = await browser.newContext({viewport: {width: 1280, height: 900}});
  const origin = `http://127.0.0.1:${server.address().port}${prefix}`;
  const page = await context.newPage(), errors = [], requests = [];
  let offlineMode = false, offlineAttempts = 0;
  page.on('pageerror', error => errors.push(error.message));
  await context.route('https://api.at.govt.nz/**', async route => {
    if (offlineMode) { offlineAttempts++; await route.abort('internetdisconnected'); return; }
    const request = route.request();
    assert.equal(request.headers()['ocp-apim-subscription-key'], 'synthetic-full-app-key');
    assert.equal(new URL(request.url()).search, '');
    requests.push(new URL(request.url()).pathname);
    await route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({header: {timestamp: Math.floor(Date.now()/1000)}, entity: []})});
  });
  await page.goto(origin + 'public/');
  await expect(page.locator('#data-status')).toContainText('offline ready', {timeout: 90000});
  await page.locator('#destination').fill('10 Victoria Road');
  await page.locator('#settings-open').click();
  await page.getByRole('button', {name: 'Device and AT-key setup', exact: true}).click();
  await page.getByRole('button', {name: 'Set up my device', exact: true}).click();
  await page.getByRole('button', {name: 'Create my device group', exact: true}).click();
  await page.getByRole('button', {name: 'Use my own AT key', exact: true}).click();
  await page.getByRole('button', {name: 'Set up live information', exact: true}).click();
  await page.getByLabel('Personal AT API key').fill('synthetic-full-app-key');
  await page.getByRole('button', {name: 'Save key on this device', exact: true}).click();
  await page.getByRole('heading', {name: 'AT key saved on this device', exact: true}).waitFor();
  assert.equal(requests.length, 0);
  // Two navigation actions in the same task leave while overview storage is
  // still awaiting its first read. The committed key must still become usable.
  await page.evaluate(() => {
    const dialog = document.querySelector('dialog[aria-label="Device and AT-key setup"]');
    [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Back').click();
    [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Back to settings').click();
  });
  await page.getByRole('button', {name: 'Close settings', exact: true}).click();
  await expect(page.locator('#destination')).toHaveValue('10 Victoria Road');
  // The actual Settings dialog reaches the restored-owner reconnect screen.
  await page.locator('#settings-open').click();
  await page.getByRole('button', {name: 'Connect an existing AT-key device', exact: true}).click();
  await page.getByRole('button', {name: 'Connect devices', exact: true}).click();
  await page.getByRole('heading', {name: 'Connect a device using your AT key', exact: true}).waitFor();
  await page.setViewportSize({width: 320, height: 640});
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  assert.equal(await page.evaluate(() => {
    const dialog = document.querySelector('dialog[aria-label="AT-key device connection"]');
    return dialog.scrollWidth <= dialog.clientWidth && document.documentElement.scrollWidth <= innerWidth;
  }), true);
  assert.deepEqual((await new AxeBuilder({page}).include('dialog[aria-label="AT-key device connection"]').analyze()).violations.map(v => v.id), []);
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await page.setViewportSize({width: 1280, height: 900});
  assert.equal(requests.length, 0);
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Connect your existing devices', exact: true}).waitFor();
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings')).toBeVisible();
  await expect(page.getByRole('button', {name: 'Connect an existing AT-key device', exact: true})).toBeFocused();
  await page.getByRole('button', {name: 'Close settings', exact: true}).click();
  const choose = async (field, query) => {
    const input = page.locator('#' + field); await input.fill(query);
    await expect(page.locator('#' + field + '-options [data-index]').first()).toBeVisible();
    await input.press('ArrowDown'); await input.press('Enter');
  };
  await choose('destination', '10 Victoria Road Devonport'); await page.locator('#destination-next').click();
  await choose('origin', '277 Broadway Newmarket'); await page.locator('#origin-next').click();
  await page.locator('#journey-preferences > summary').click();
  await page.locator('#date').fill('2026-09-23'); await page.locator('#time').fill('09:00'); await page.locator('#find').click();
  await expect(page.locator('.journey-card').first()).toBeVisible({timeout: 30000});
  await expect(page.locator('.journey-card').first()).toContainText('Ferry');
  await page.locator('[data-follow]').first().click();
  assert.equal(requests.length, 0);
  await expect(page.locator('#journey-live')).toBeVisible();
  // A settings connection change updates this selected journey without a new search.
  await page.evaluate(async () => {
    const bridge = await import('../experiments/at-credentials/app-live-bridge.mjs');
    window.restoreTestConnection = bridge.configureAppLiveConnection;
    bridge.configureAppLiveConnection(undefined);
  });
  await expect(page.locator('#journey-live')).toBeHidden();
  await page.evaluate(async () => {
    const wasm = await import('../experiments/tg-pairing/hive_wasm.js');
    const {openBrowserStorage} = await import('../experiments/tg-pairing/storage.mjs');
    const store = await openBrowserStorage('along-pairing-lab-v1');
    const saved = await store.read('candidate-persona', 'active');
    const {createSavedATClient} = await import('../experiments/at-credentials/saved-client.mjs');
    window.testLiveStore = store;
    window.restoreTestConnection(() => createSavedATClient({wasm, store, expectedGroup: saved.value.record.group}));
  });
  await expect(page.locator('#journey-live')).toBeVisible();
  await page.locator('#journey-alert-check').click();
  await expect(page.locator('#journey-prediction-results')).toContainText('No live departure match', {timeout: 15000});
  assert.deepEqual(requests.sort(), ['/realtime/legacy/servicealerts', '/realtime/legacy/tripupdates']);
  assert.equal((await page.locator('body').textContent()).includes('synthetic-full-app-key'), false);
  await page.evaluate(() => { window.testLiveStore.close(); delete window.testLiveStore; });
  const selectedStep = await page.locator('#current-step').textContent();
  // Deterministic lifecycle checks, explicitly distinct from a real cache restore.
  for (let cycle = 0; cycle < 2; cycle++) {
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted: true})));
    assert.equal(await page.evaluate(async () => (await import('../experiments/at-credentials/app-live-bridge.mjs')).createLiveClient().configured), false);
    assert.equal(await page.getByRole('button', {name: 'Device and AT-key setup', exact: true, includeHidden: true}).count(), 0);
    await page.evaluate(async () => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true}));
      await (await import('../experiments/at-credentials/app-bootstrap.mjs')).restoration;
      window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true}));
    });
    assert.equal(await page.getByRole('button', {name: 'Device and AT-key setup', exact: true, includeHidden: true}).count(), 1);
    assert.equal(await page.getByRole('button', {name: 'Connect an existing AT-key device', exact: true, includeHidden: true}).count(), 1);
    await expect(page.locator('#journey-live')).toBeVisible();
    assert.equal(await page.locator('#current-step').textContent(), selectedStep);
  }
  if (process.env.CHECK_BFCACHE === '1') {
    const token = await page.evaluate(() => {
      window.returnToken = crypto.randomUUID(); window.cachedReturn = false;
      window.addEventListener('pageshow', event => { window.cachedReturn = event.persisted; });
      return window.returnToken;
    });
    await page.goto(origin + 'public/install.html');
    await page.goBack({waitUntil: 'commit'});
    await page.waitForFunction(() => window.cachedReturn === true || !window.returnToken);
    const returned = await page.evaluate(() => ({token: window.returnToken, persisted: window.cachedReturn,
      reasons: performance.getEntriesByType('navigation')[0]?.notRestoredReasons?.toJSON()}));
    assert.equal(returned.token, token, JSON.stringify(returned));
    assert.equal(returned.persisted, true, JSON.stringify(returned));
    await page.evaluate(async () => { await (await import('../experiments/at-credentials/app-bootstrap.mjs')).restoration; });
    await expect(page.locator('#journey-live')).toBeVisible();
    assert.equal(await page.locator('#current-step').textContent(), selectedStep);
    await page.locator('#settings-open').click();
    await page.getByRole('button', {name: 'Device and AT-key setup', exact: true}).click();
    await page.getByRole('button', {name: 'Manage my AT key', exact: true}).waitFor();
    await page.getByRole('button', {name: 'Back to settings', exact: true}).click();
    await page.getByRole('button', {name: 'Close settings', exact: true}).click();
    console.log('PASS: actual browser Back restored the same cached document and revived Settings without losing the selected step.');
  }
  assert.equal(requests.length, 2);
  // A normal installed-shell reopen must retain the runtime modules offline.
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  offlineMode = true; await context.setOffline(true); await page.reload();
  await expect(page.locator('#data-status')).toContainText('offline ready', {timeout: 30000});
  assert.equal(await page.evaluate(() => fetch('./uncached-offline-probe', {cache: 'no-store'}).then(() => false, () => true)), true);
  const reportedOnline = await page.evaluate(() => navigator.onLine);
  await choose('destination', '1 Queen Street Auckland Central'); await page.locator('#destination-next').click();
  await choose('origin', '277 Broadway Newmarket'); await page.locator('#origin-next').click();
  await page.locator('#journey-preferences > summary').click();
  await page.locator('#date').fill('2026-09-23'); await page.locator('#time').fill('09:00'); await page.locator('#find').click();
  await expect(page.locator('.journey-card').first()).toBeVisible({timeout: 30000});
  await page.locator('[data-follow]').first().click();
  await page.locator('#journey-alert-check').click();
  await expect(page.locator('#journey-prediction-results')).toContainText('unavailable');
  assert.equal(requests.length, 2);
  // Optional WASM can stall even with a saved identity. Planning must start,
  // and a late runtime result must not silently enable live access afterwards.
  await context.setOffline(false); offlineMode = false;
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      window.settingsReadyAtDOMContentLoaded = typeof document.querySelector('#settings-open')?.onclick === 'function';
    }, {once: true});
    const original = window.fetch;
    window.fetch = (input, options) => {
      const url = typeof input === 'string' ? input : input.url || String(input);
      if (url.includes('/experiments/tg-pairing/hive_wasm_bg.wasm')) {
        return new Promise((resolve, reject) => { window.releaseOptionalRuntime = () => original(input, options).then(resolve, reject); });
      }
      return original(input, options);
    };
  });
  await page.reload({waitUntil: 'domcontentloaded', timeout: 15000});
  assert.equal(await page.evaluate(() => settingsReadyAtDOMContentLoaded), true,
    'Settings handlers must be ready without waiting for optional WASM');
  await expect(page.locator('#data-status')).toContainText('offline ready', {timeout: 15000});
  assert.equal(await page.evaluate(() => typeof releaseOptionalRuntime), 'function');
  assert.equal(await page.evaluate(async () => (await import('../experiments/at-credentials/app-live-bridge.mjs')).createLiveClient().configured), false);
  await choose('destination', '10 Victoria Road Devonport'); await page.locator('#destination-next').click();
  await choose('origin', '277 Broadway Newmarket'); await page.locator('#origin-next').click();
  await page.locator('#journey-preferences > summary').click();
  await page.locator('#date').fill('2026-09-23'); await page.locator('#time').fill('09:00'); await page.locator('#find').click();
  await expect(page.locator('.journey-card').first()).toContainText('Ferry', {timeout: 30000});
  await page.locator('[data-follow]').first().click();
  await expect(page.locator('#journey-live')).toBeHidden();
  await page.evaluate(async () => { releaseOptionalRuntime(); await (await import('../experiments/at-credentials/app-bootstrap.mjs')).restoration; });
  assert.equal(await page.evaluate(async () => (await import('../experiments/at-credentials/app-live-bridge.mjs')).createLiveClient().configured), false);
  assert.equal(requests.length, 2);
  // A newer, unreadable lab schema must not be reset or hold up the planner.
  await page.goto(origin + 'public/install.html');
  const futureCount = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('r2-browser:along-pairing-lab-v1', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, count = db.transaction('records').objectStore('records').count();
      count.onsuccess = () => { const value = count.result; db.close(); resolve(value); };
    };
  }));
  assert.ok(futureCount > 0);
  await page.addInitScript(() => {
    window.r2WriteAttempts = 0;
    for (const method of ['put', 'add', 'delete', 'clear']) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function(...args) {
        if (this.transaction.db.name === 'r2-browser:along-pairing-lab-v1') r2WriteAttempts++;
        return original.apply(this, args);
      };
    }
  });
  await page.goto(origin + 'public/');
  await expect(page.locator('#data-status')).toContainText('offline ready', {timeout: 15000});
  assert.equal(await page.evaluate(() => r2WriteAttempts), 0);
  assert.equal(await page.evaluate(async () => (await import('../experiments/at-credentials/app-live-bridge.mjs')).createLiveClient().configured), false);
  assert.deepEqual(await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('r2-browser:along-pairing-lab-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, version = db.version, count = db.transaction('records').objectStore('records').count();
      count.onsuccess = () => { const value = count.result; db.close(); resolve({version, count: value}); };
    };
  })), {version: 2, count: futureCount});
  assert.equal(requests.length, 2);
  assert.deepEqual(errors, []);
  console.log('PASS: unreadable newer lab schema leaves the planner ready and preserves the actual database version and record count.');
  console.log('PASS: stalled optional WASM cannot block actual bus/ferry planning; late restore cannot enable live access after its startup deadline.');
  console.log('Offline evidence:', JSON.stringify({uncachedRequestFailed: true, reportedOnline, blockedMockProviderAttempts: offlineAttempts}));
  console.log('PASS: actual static journey app -> real device/key setup -> address-to-address bus/ferry journey -> explicit direct mocked AT reads using encrypted key; no startup request or displayed key; offline reopen includes experimental runtime and address routing; offline live check falls back quietly without a provider response. Local-only owner-key journey test; Settings setup/reconnect and Back verified; separate two-app test covers shared-device use.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
