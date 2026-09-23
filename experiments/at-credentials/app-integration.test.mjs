// Actual generated journey app on a static subpath, with a real local software
// identity/vault and mocked provider. No production key or proxy is involved.
import assert from 'node:assert/strict';
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
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
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
  await page.goto(origin + 'experiments/');
  await page.getByRole('button', {name: 'Set up this test device', exact: true}).click();
  await page.getByRole('button', {name: 'Create my device group', exact: true}).click();
  await page.getByRole('button', {name: 'Restore saved test device', exact: true}).click();
  await page.getByRole('button', {name: 'Test optional AT-key storage', exact: true}).click();
  await page.getByRole('button', {name: 'Set up live information', exact: true}).click();
  await page.getByLabel('Personal AT API key').fill('synthetic-full-app-key');
  await page.getByRole('button', {name: 'Save key on this device', exact: true}).click();
  await page.getByRole('heading', {name: 'AT key saved on this device', exact: true}).waitFor();
  assert.equal(requests.length, 0);
  await page.goto(origin + 'public/');
  await expect(page.locator('#data-status')).toContainText('offline ready', {timeout: 90000});
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
  await page.locator('#journey-alert-check').click();
  await expect(page.locator('#journey-prediction-results')).toContainText('No live departure match', {timeout: 15000});
  assert.deepEqual(requests.sort(), ['/realtime/legacy/servicealerts', '/realtime/legacy/tripupdates']);
  assert.equal((await page.locator('body').textContent()).includes('synthetic-full-app-key'), false);
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
  assert.deepEqual(errors, []);
  console.log('Offline evidence:', JSON.stringify({uncachedRequestFailed: true, reportedOnline, blockedMockProviderAttempts: offlineAttempts}));
  console.log('PASS: actual static journey app -> real device/key setup -> address-to-address bus/ferry journey -> explicit direct mocked AT reads using encrypted key; no startup request or displayed key; offline reopen includes experimental runtime and address routing; offline live check falls back quietly without a provider response. Local-only, owner key; shared-owner reconnection not wired.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
