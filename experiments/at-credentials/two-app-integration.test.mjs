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
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const origin = `http://127.0.0.1:${server.address().port}${prefix}`;
  const providerRequests = [], errors = [];
  for (const page of pages) page.on('pageerror', error => errors.push(error.message));
  for (const context of contexts) await context.route('https://api.at.govt.nz/**', async route => {
    assert.equal(route.request().headers()['ocp-apim-subscription-key'], 'synthetic-two-app-key');
    providerRequests.push(new URL(route.request().url()).pathname);
    await route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({header: {timestamp: Math.floor(Date.now()/1000)}, entity: []})});
  });
  await Promise.all(pages.map(async (page, index) => {
    await page.goto(origin + 'experiments/');
    await page.getByRole('button', {name: 'Set up this test device', exact: true}).click();
    await page.getByRole('button', {name: 'Create my device group', exact: true}).click();
    await page.getByRole('button', {name: 'Restore saved test device', exact: true}).click();
    await page.getByRole('button', {name: index ? 'Invite my other device' : 'Join my other device', exact: true}).click();
  }));
  const [candidate, owner] = pages;
  await owner.getByRole('heading', {name: 'Invite your other device', exact: true}).waitFor();
  const move = async (from, to, label, action) => {
    const text = await from.getByLabel('Device message to copy').inputValue();
    await to.getByLabel(label, {exact: true}).fill(text);
    await to.getByRole('button', {name: action, exact: true}).click();
  };
  await move(owner, candidate, 'Invitation text', 'Review invitation');
  await candidate.getByRole('button', {name: 'Use invitation from my other device', exact: true}).click();
  await candidate.getByRole('heading', {name: 'Check your other device', exact: true}).waitFor();
  await move(candidate, owner, 'Challenge from your other device', 'Create device reply');
  await owner.getByRole('heading', {name: 'Send your device reply', exact: true}).waitFor();
  await move(owner, candidate, 'Reply from your other device', 'Check reply');
  await candidate.getByRole('heading', {name: 'Send connection details', exact: true}).waitFor();
  await move(candidate, owner, 'Connection details from your other device', 'Prepare connection');
  await owner.getByRole('heading', {name: 'Send the connection reply', exact: true}).waitFor();
  await move(owner, candidate, 'Connection reply from your other device', 'Compare device codes');
  await owner.getByRole('button', {name: 'Compare device codes', exact: true}).click();
  await Promise.all(pages.map(page => page.getByRole('heading', {name: 'Do both devices show this code?', exact: true}).waitFor()));
  assert.equal(await candidate.locator('.pairing-code').textContent(), await owner.locator('.pairing-code').textContent());

  await Promise.all(pages.map(async page => {
    await page.getByRole('button', {name: 'Both devices are here and the codes match', exact: true}).click();
  }));
  await candidate.getByRole('heading', {name: 'Device connected', exact: true}).waitFor();
  await owner.getByRole('heading', {name: 'Other device installed', exact: true}).waitFor();

  await Promise.all(pages.map(page => page.reload()));
  await Promise.all(pages.map(page => page.getByRole('button', {name: 'Restore saved test device', exact: true}).click()));
  await owner.getByRole('button', {name: 'Test optional AT-key storage', exact: true}).click();
  await owner.getByRole('button', {name: 'Set up live information', exact: true}).click();
  await owner.getByLabel('Personal AT API key', {exact: true}).fill('synthetic-two-app-key');
  await owner.getByRole('button', {name: 'Save key on this device', exact: true}).click();
  await owner.getByRole('heading', {name: 'AT key saved on this device', exact: true}).waitFor();
  await owner.getByRole('button', {name: 'Back', exact: true}).click();
  await owner.getByRole('button', {name: 'Restore saved test device', exact: true}).click();
  await owner.getByRole('button', {name: 'Share my AT key', exact: true}).click();
  await candidate.getByRole('button', {name: 'Receive a shared AT key', exact: true}).click();
  await owner.getByRole('heading', {name: 'Share your AT key', exact: true}).waitFor();
  await move(owner, candidate, 'AT-key sharing message', 'Review sharing device');
  await candidate.getByRole('button', {name: 'Back', exact: true}).click();
  await candidate.getByRole('button', {name: 'Restore saved test device', exact: true}).click();
  await candidate.getByRole('button', {name: 'Receive a shared AT key', exact: true}).click();
  await move(owner, candidate, 'AT-key sharing message', 'Review sharing device');
  const noAcceptedOwner = () => candidate.evaluate(async () => {
    const store = await (await import('./tg-pairing/storage.mjs')).openBrowserStorage('along-pairing-lab-v1');
    try {
      const record = (await store.read('candidate-persona', 'active')).value.record;
      const group = Array.from(record.group, b => b.toString(16).padStart(2, '0')).join('');
      return await store.read('along-at-owners', group) === null;
    } finally { store.close(); }
  });
  assert.equal(await noAcceptedOwner(), true);
  await candidate.setViewportSize({width: 320, height: 640});
  await candidate.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  assert.equal(await candidate.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual((await new AxeBuilder({page: candidate}).analyze()).violations.map(v => v.id), []);
  await candidate.getByRole('button', {name: 'Connect to this sharing device', exact: true}).click();
  await candidate.getByRole('heading', {name: 'Connect for key sharing', exact: true}).waitFor();
  await move(candidate, owner, 'Sharing connection request', 'Connect for key sharing');
  await owner.getByRole('heading', {name: 'Send the sharing reply', exact: true}).waitFor();
  await move(owner, candidate, 'Sharing connection reply', 'Check sharing connection');
  await owner.getByRole('button', {name: 'Allow AT access', exact: true}).click();
  const acceptKey = candidate.getByRole('button', {name: 'Allow this device to receive the key', exact: true});
  await acceptKey.waitFor();
  if (process.env.INTERRUPT_GRANT === '1') {
    const snapshot = page => page.evaluate(async () => {
      const store = await (await import('./tg-pairing/storage.mjs')).openBrowserStorage('along-pairing-lab-v1');
      try {
        const record = (await store.read('candidate-persona', 'active')).value.record;
        const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
        const anchor = await store.read('along-at-owners', hex(record.group));
        const policy = anchor && await store.read('along-at-policy:' + anchor.value.owner, hex(record.group) + ':' + anchor.value.credential);
        return {member: hex(record.subject), anchorRevision: anchor?.revision, policyRevision: policy?.revision};
      } finally { store.close(); }
    });
    const before = await Promise.all(pages.map(snapshot));
    assert.equal(await noAcceptedOwner(), true);
    await Promise.all(pages.map(page => page.reload()));
    await Promise.all(pages.map(page => page.getByRole('button', {name: 'Restore saved test device', exact: true}).click()));
    await owner.getByRole('button', {name: 'Share my AT key', exact: true}).click();
    await candidate.getByRole('button', {name: 'Receive a shared AT key', exact: true}).click();
    await owner.getByRole('heading', {name: 'Share your AT key', exact: true}).waitFor();
    await move(owner, candidate, 'AT-key sharing message', 'Review sharing device');
    await candidate.getByRole('button', {name: 'Connect to this sharing device', exact: true}).click();
    await candidate.getByRole('heading', {name: 'Connect for key sharing', exact: true}).waitFor();
    await move(candidate, owner, 'Sharing connection request', 'Connect for key sharing');
    await owner.getByRole('heading', {name: 'Send the sharing reply', exact: true}).waitFor();
    await move(owner, candidate, 'Sharing connection reply', 'Check sharing connection');
    const resume = owner.getByRole('button', {name: 'Continue sharing my key', exact: true});
    await resume.waitFor();
    assert.equal(await owner.getByRole('button', {name: 'Remove AT access', exact: true}).count(), 0);
    await resume.evaluate(button => button.click());
    assert.equal(await candidate.getByRole('button', {name: 'Allow this device to receive the key', exact: true}).count(), 0);
    assert.deepEqual(await Promise.all(pages.map(snapshot)), before);
    await resume.focus(); await owner.keyboard.press('Enter');
    await acceptKey.waitFor();
    assert.deepEqual(await Promise.all(pages.map(snapshot)), before, 'resuming does not rewrite identities, owner binding or grant');
    assert.equal(providerRequests.length, 0);
  }
  await acceptKey.evaluate(button => button.click());
  assert.equal(await noAcceptedOwner(), true, 'synthetic activation cannot accept an owner or request delivery');
  assert.deepEqual((await new AxeBuilder({page: candidate}).analyze()).violations.map(v => v.id), []);
  await acceptKey.focus(); await candidate.keyboard.press('Enter');
  await candidate.getByRole('heading', {name: 'Shared AT key saved', exact: true}).waitFor();
  await owner.getByRole('heading', {name: 'Other device saved the key', exact: true}).waitFor();
  assert.equal(providerRequests.length, 0);
  await candidate.setViewportSize({width: 1280, height: 900});
  await Promise.all(pages.map(page => page.goto(origin + 'public/')));
  await Promise.all(pages.map(page => expect(page.locator('#data-status')).toContainText('offline ready', {timeout: 90000})));
  for (const page of pages) {
    await page.locator('#settings-open').click();
    await page.getByRole('button', {name: 'Connect an existing AT-key device', exact: true}).click();
    await page.getByRole('button', {name: 'Connect devices', exact: true}).click();
  }
  await candidate.getByRole('heading', {name: 'Connect to your AT-key device', exact: true}).waitFor();
  await move(candidate, owner, 'Connection request', 'Prepare connection reply');
  await owner.getByRole('heading', {name: 'Reply to your other device', exact: true}).waitFor();
  await move(owner, candidate, 'Connection reply', 'Connect devices');
  for (const page of pages) {
    await page.getByRole('button', {name: 'Use this connection', exact: true}).click();
    await page.getByRole('heading', {name: 'Your devices are connected', exact: true}).waitFor();
    await page.getByRole('button', {name: 'Back to settings', exact: true}).click();
    await page.getByRole('button', {name: 'Close settings', exact: true}).click();
  }
  assert.equal(providerRequests.length, 0);
  const choose = async (field, query) => {
    const input = candidate.locator('#' + field); await input.fill(query);
    await expect(candidate.locator('#' + field + '-options [data-index]').first()).toBeVisible();
    await input.press('ArrowDown'); await input.press('Enter');
  };
  await choose('destination', '10 Victoria Road Devonport'); await candidate.locator('#destination-next').click();
  await choose('origin', '277 Broadway Newmarket'); await candidate.locator('#origin-next').click();
  await candidate.locator('#journey-preferences > summary').click();
  await candidate.locator('#date').fill('2026-09-23'); await candidate.locator('#time').fill('09:00'); await candidate.locator('#find').click();
  await expect(candidate.locator('.journey-card').first()).toBeVisible({timeout: 30000});
  await expect(candidate.locator('.journey-card').first()).toContainText('Ferry');
  await candidate.locator('[data-follow]').first().click();
  const step = await candidate.locator('#current-step').textContent();
  await candidate.locator('#journey-alert-check').click();
  await expect(candidate.locator('#journey-prediction-results')).toContainText('No live departure match', {timeout: 15000});
  assert.deepEqual(providerRequests.sort(), ['/realtime/legacy/servicealerts', '/realtime/legacy/tripupdates']);
  assert.equal((await candidate.locator('body').textContent()).includes('synthetic-two-app-key'), false);
  // Withhold a removal push: the next contextual read must learn the signed
  // owner change before AT receives another request. Removal UI remains separate.
  await owner.evaluate(async () => {
    const wasm = await import('../experiments/tg-pairing/hive_wasm.js');
    const store = await (await import('../experiments/tg-pairing/storage.mjs')).openBrowserStorage('along-pairing-lab-v1');
    try {
      const record = (await store.read('candidate-persona', 'active')).value.record;
      const {binding} = await (await import('../experiments/at-credentials/local-owner.mjs')).loadATBinding({wasm, store, expectedGroup: record.group});
      const loaded = await (await import('../experiments/at-credentials/policy-store.mjs')).openCredentialPolicyStore({store, ...binding}).read();
      await (await import('../experiments/at-credentials/owner-policy.mjs')).updateLocalATPolicy({wasm, store, expectedGroup: record.group,
        expectedRevision: loaded.policy.revision, devices: [binding.owner]});
    } finally { store.close(); }
  });
  await candidate.locator('#journey-alert-check').click();
  await expect(candidate.locator('#journey-prediction-results')).toContainText('Live departure predictions unavailable', {timeout: 15000});
  assert.equal(providerRequests.length, 2);
  await owner.locator('#settings-open').click();
  await owner.getByRole('button', {name: 'Connect an existing AT-key device', exact: true}).click();
  await owner.getByRole('button', {name: 'Disconnect devices', exact: true}).click();
  await expect(candidate.locator('#journey-live')).toBeHidden({timeout: 15000});
  assert.equal(await candidate.locator('#current-step').textContent(), step);
  assert.equal(providerRequests.length, 2);
  await candidate.evaluate(async () => { await navigator.serviceWorker.ready; });
  await candidate.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await contexts[0].setOffline(true);
  await candidate.reload();
  await expect(candidate.locator('#data-status')).toContainText('offline ready', {timeout: 90000});
  await choose('destination', '1 Queen Street Auckland Central'); await candidate.locator('#destination-next').click();
  await choose('origin', '277 Broadway Newmarket'); await candidate.locator('#origin-next').click();
  await candidate.locator('#find').click();
  await expect(candidate.locator('.journey-card').first()).toBeVisible({timeout: 30000});
  await candidate.locator('[data-follow]').first().click();
  await expect(candidate.locator('#journey-live')).toBeHidden();
  assert.equal(providerRequests.length, 2);
  assert.deepEqual(errors, []);
  console.log('PASS: two isolated browser app instances restore actual enrollment and encrypted WebRTC-delivered key, reconnect through Settings, close Settings, request contextual mocked AT feeds for a real bus/ferry journey, learn withheld removal before further provider I/O, disconnect without changing the selected step, and reopen/route offline. Setup grant/consent uses visible controls; removal uses a runtime harness call; one host, not physical devices or real provider verification.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
