import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import AxeBuilder from '@axe-core/playwright';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const sources = new Map();
for (const name of ['credential-view.mjs', 'credential-view.css', '../tg-pairing/comparison.css']) {
  sources.set('/' + name.split('/').pop(), await readFile(new URL(name, import.meta.url)));
}
for (const name of ['storage.mjs', 'membership.mjs', 'certificate.mjs']) sources.set('/' + name, await readFile(join(process.env.R2_BROWSER_DIR, name)));
for (const name of ['../tg-pairing/initial-persona.mjs', '../tg-pairing/local-persona.mjs', 'local-owner.mjs', 'policy.mjs', 'policy-store.mjs', 'local-vault.mjs']) sources.set('/' + name.split('/').pop(), await readFile(new URL(name, import.meta.url)));
for (const name of ['hive_wasm.js', 'hive_wasm_bg.wasm']) sources.set('/' + name, await readFile(join(process.env.R2_WASM_DIR, name)));
const server = createServer((req, res) => {
  const path = '/' + req.url.split('/').pop();
  res.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : path.endsWith('.css') ? 'text/css' : sources.has(path) ? 'text/javascript' : 'text/html');
  res.end(sources.get(path) || '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>AT setup check</title><link rel="stylesheet" href="/credential-view.css"></head><body><main><h1 style="font:600 1.5rem system-ui;overflow-wrap:anywhere">Live information</h1><div id="setup"></div></main></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const context = await browser.newContext({viewport: {width: 360, height: 780}, reducedMotion: 'reduce'});
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    const {showCredentialSetup} = await import('./credential-view.mjs');
    window.calls = []; window.backs = 0;
    window.mount = vault => showCredentialSetup(document.querySelector('#setup'), {vault: {inspect: async () => ({status: 'missing', canSave: true}), ...vault}, focus: true, onBack: () => { backs++; }});
    window.view = mount({saveOwnerKey: async (key, {signal}) => { calls.push({key, signal}); return {status: 'credential-saved'}; }});
  });
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'H2');
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.type), 'password');
  await page.keyboard.type('synthetic-key');
  await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  await page.getByRole('heading', {name: 'AT key saved on this device'}).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Back');
  assert.equal(await page.evaluate(() => document.querySelector('input').value), '');
  assert.equal(await page.evaluate(() => calls.length), 1);
  assert.equal(await page.evaluate(async () => (await view.completed).status), 'credential-saved');
  assert.equal(await page.getByRole('status').textContent(), 'The key has not been checked with AT. Return to your stop or journey to choose live information.');
  await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => backs), 1);
  await page.evaluate(() => {
    window.view = mount({saveOwnerKey: async () => { throw new Error('private synthetic failure'); }});
  });
  await page.getByLabel('Personal AT API key').fill('bad key');
  await page.getByRole('button', {name: 'Save key on this device'}).click();
  assert.equal(await page.getByLabel('Personal AT API key').getAttribute('aria-invalid'), 'true');
  await page.getByLabel('Personal AT API key').fill('synthetic-key');
  await page.getByRole('button', {name: 'Save key on this device'}).click();
  await page.getByRole('status').filter({hasText: 'could not be confirmed'}).waitFor();
  assert.equal((await page.locator('body').textContent()).includes('private synthetic failure'), false);
  assert.equal(await page.evaluate(() => document.querySelector('input').value), '');
  // Leave while saving, then mount a successor. Late completion must not replace it.
  await page.evaluate(() => {
    window.view = mount({saveOwnerKey: (key, {signal}) => {
      window.pendingSignal = signal; return new Promise(resolve => { window.release = resolve; });
    }});
  });
  await page.getByLabel('Personal AT API key').fill('synthetic-pending');
  await page.getByRole('button', {name: 'Save key on this device'}).click();
  await page.getByRole('status').filter({hasText: 'Saving on this device'}).waitFor();
  await page.getByRole('button', {name: 'Back', exact: true}).click();
  assert.equal(await page.evaluate(() => pendingSignal.aborted), true);
  await page.evaluate(() => { window.view = mount({saveOwnerKey: async () => { throw new Error('unused'); }}); release({status: 'credential-saved'}); });
  await page.getByRole('heading', {name: 'Add your AT key', exact: true}).waitFor();
  assert.equal(await page.getByRole('status').textContent(), 'No AT key is saved for these live-information settings.');
  await page.setViewportSize({width: 320, height: 640});
  await page.evaluate(() => document.documentElement.style.fontSize = '200%');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
  const widths = await page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.getBoundingClientRect().width));
  assert.equal(widths[0], widths[1]);
  await page.getByLabel('Personal AT API key').fill('synthetic-unsaved');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.querySelector('input').value), '');
  await page.evaluate(async () => {
    window.view = mount({inspect: async () => ({status: 'replacement-needed', canSave: true}), saveOwnerKey: async () => {}});
    await view.ready;
  });
  await page.getByRole('heading', {name: 'Add your replacement AT key'}).waitFor();
  assert.equal(await page.getByRole('button', {name: 'Save key on this device'}).count(), 1);
  await page.evaluate(async () => {
    let finish;
    const pending = mount({inspect: () => new Promise(resolve => { finish = resolve; }), saveOwnerKey: async () => {}});
    window.view = mount({inspect: async () => { throw new Error('unreadable'); }, saveOwnerKey: async () => {}});
    await view.ready; finish({status: 'missing', canSave: true}); await pending.ready;
  });
  await page.getByRole('heading', {name: 'Live information unavailable on this device'}).waitFor();
  assert.equal(await page.getByRole('button', {name: 'Save key on this device'}).count(), 0);
  // Exercise the same consent screen with actual WASM identity and encrypted storage.
  await page.evaluate(async () => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    window.realStore = await (await import('./storage.mjs')).openBrowserStorage('credential-view-real');
    const initial = await (await import('./initial-persona.mjs')).initializeLocalPersona({wasm, store: realStore}); initial.close();
    const expectedGroup = (await realStore.read('candidate-persona', 'active')).value.record.group;
    const {binding} = await (await import('./local-owner.mjs')).establishLocalATOwner({wasm, store: realStore, expectedGroup});
    window.realVault = (await import('./local-vault.mjs')).openLocalATVault({wasm, store: realStore, ...binding});
    window.view = mount(realVault);
  });
  await page.getByLabel('Personal AT API key').fill('synthetic-browser-consent');
  await page.getByRole('button', {name: 'Save key on this device'}).click();
  await page.getByRole('heading', {name: 'AT key saved on this device'}).waitFor();
  assert.equal(await page.evaluate(async () => await realVault.getKey() === 'synthetic-browser-consent'), true);
  await page.evaluate(async () => { window.view = mount(realVault); await view.ready; });
  assert.equal(await page.getByRole('button', {name: 'Save key on this device'}).count(), 0);
  assert.equal((await page.getByRole('status').textContent()).includes('can be opened locally'), true);
  await page.evaluate(() => { view.dispose(); realStore.close(); });
  console.log('PASS: credential consent keyboard save, honest unverified status, generic failure, cleared inputs, Back/Escape cancellation, late completion isolation, equal-width actions, axe and narrow enlarged text; actual WASM identity and encrypted vault save. Synthetic keys; no real TalkBack/device/provider test.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
