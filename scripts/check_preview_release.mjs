// Verify deployed payload bytes and exercise HTTPS setup/offline routing in a
// fresh profile. No production key, AT request or persistent user profile.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
const {chromium, expect} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const url = new URL(process.argv[2]);
assert.equal(url.protocol, 'https:'); assert.ok(url.pathname.endsWith('/'));
const local = JSON.parse(await readFile(new URL('../releases/along-device-preview-release/build-info.json', import.meta.url), 'utf8'));
assert.equal(local.profile, 'along-device-preview-release-v1');
const retrieve = async name => {
  const target = new URL(name, url); target.searchParams.set('preview', local.appVersion);
  const response = await fetch(target, {redirect: 'error'});
  assert.equal(response.status, 200, name); return Buffer.from(await response.arrayBuffer());
};
assert.deepEqual(JSON.parse((await retrieve('build-info.json')).toString()), local);
const queue = Object.entries(local.files);
await Promise.all(Array.from({length: 4}, async () => {
  while (queue.length) {
    const [name, expected] = queue.pop();
    assert.equal(createHash('sha256').update(await retrieve(name)).digest('hex'), expected, name);
  }
}));
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
try {
  const context = await browser.newContext(), unexpected = [], errors = [];
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === url.origin) return route.continue();
    unexpected.push(new URL(route.request().url()).origin); return route.abort();
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  const app = new URL('public/', url);
  await page.goto(app.href);
  await expect(page.locator('#settings')).toContainText('App version ' + local.appVersion);
  await expect(page.locator('#address-status')).toContainText('ready offline', {timeout: 90000});
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(new URL('sw.js', app).href);
  await page.locator('#settings-open').click();
  await page.getByRole('button', {name: 'Device and AT-key setup', exact: true}).click();
  await page.getByRole('button', {name: 'Set up my device', exact: true}).click();
  await page.getByRole('button', {name: 'Create my device group', exact: true}).click();
  await page.getByRole('heading', {name: 'Your devices and AT key', exact: true}).waitFor();
  await page.reload();
  await page.locator('#settings-open').click();
  await page.getByRole('button', {name: 'Device and AT-key setup', exact: true}).click();
  await page.getByRole('heading', {name: 'Your devices and AT key', exact: true}).waitFor();
  await context.setOffline(true); await page.goto(new URL('install.html', app).href);
  await expect(page.getByRole('heading', {level: 1})).toHaveText('Install Along Device Preview');
  await page.goto(app.href);
  await expect(page.locator('#address-status')).toContainText('ready offline', {timeout: 30000});
  for (const [field, query] of [['destination', '10 Victoria Road Devonport'], ['origin', '277 Broadway Newmarket']]) {
    const input = page.locator('#' + field); await input.fill(query);
    await expect(page.locator('#' + field + '-options [data-index]').first()).toBeVisible();
    await input.press('ArrowDown'); await input.press('Enter');
    await page.locator('#' + field + '-next').click();
  }
  await page.locator('#journey-preferences > summary').click();
  await page.locator('#date').fill('2026-09-23'); await page.locator('#time').fill('09:00'); await page.locator('#find').click();
  await expect(page.locator('.journey-card').first()).toContainText('Ferry', {timeout: 30000});
  assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
  const evidence = {profile: 'along-preview-public-check-v1', checked_at: new Date().toISOString(), url: url.href,
    app_version: local.appVersion, source_commit: local.source_commit,
    manifest_sha256: createHash('sha256').update(await readFile(new URL('../releases/along-device-preview-release/build-info.json', import.meta.url))).digest('hex'),
    payload_files_verified: Object.keys(local.files).length, https_setup_reload: true, offline_install_guide: true,
    offline_new_address_bus_ferry_journey: true, page_errors: errors, external_requests: unexpected,
    limits: 'Fresh Chromium profile on one host; physical-device and real-provider checks remain separate.'};
  if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} finally { await browser.close(); }
