import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import AxeBuilder from '@axe-core/playwright';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const sources = new Map();
for (const name of ['settings-view.mjs', 'key-replacement-view.mjs', 'credential-view.mjs', 'credential-view.css', '../tg-pairing/comparison.css']) {
  sources.set('/' + name.split('/').pop(), await readFile(new URL(name, import.meta.url)));
}
for (const name of ['storage.mjs', 'membership.mjs', 'certificate.mjs']) sources.set('/' + name, await readFile(join(process.env.R2_BROWSER_DIR, name)));
for (const name of ['../tg-pairing/initial-persona.mjs', '../tg-pairing/local-persona.mjs', 'local-owner.mjs', 'owner-policy.mjs', 'policy.mjs', 'policy-store.mjs', 'local-vault.mjs', 'delivery-ack.mjs', 'delivery-message.mjs']) sources.set('/' + name.split('/').pop(), await readFile(new URL(name, import.meta.url)));
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
  const context = await browser.newContext({viewport: {width: 360, height: 780}});
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    window.wasm = await import('./hive_wasm.js'); await wasm.default();
    window.store = await (await import('./storage.mjs')).openBrowserStorage('at-settings-view');
    const initial = await (await import('./initial-persona.mjs')).initializeLocalPersona({wasm, store}); initial.close();
    window.group = (await store.read('candidate-persona', 'active')).value.record.group;
    window.groupHex = initial.group; window.backs = 0;
    window.settingsModule = await import('./settings-view.mjs');
    window.mount = options => settingsModule.showATSettings(document.querySelector('#setup'), {wasm, store, expectedGroup: group, focus: true, onBack: () => { backs++; }, ...options});
    window.view = mount(); await view.ready;
  });
  assert.equal(await page.evaluate(() => store.read('along-at-owners', groupHex)), null);
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
  await page.evaluate(() => document.querySelector('.pairing-primary').click());
  assert.equal(await page.evaluate(() => store.read('along-at-owners', groupHex)), null);
  await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  await page.getByRole('heading', {name: 'Add your AT key', exact: true}).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Add your AT key');
  await page.getByLabel('Personal AT API key').fill('synthetic-settings-key');
  await page.getByRole('button', {name: 'Save key on this device'}).click();
  await page.getByRole('heading', {name: 'AT key saved on this device'}).waitFor();
  await page.getByRole('button', {name: 'Back', exact: true}).click();
  assert.equal(await page.evaluate(() => backs), 1);
  const revision = await page.evaluate(async () => (await store.read('along-at-owners', groupHex)).revision);
  await page.evaluate(async () => { window.view = mount(); await view.ready; });
  await page.getByRole('heading', {name: 'AT key saved on this device'}).waitFor();
  assert.equal(await page.getByRole('button', {name: 'Set up live information'}).count(), 0);
  assert.equal(await page.getByRole('button', {name: 'Save key on this device'}).count(), 0);
  assert.equal(await page.evaluate(async () => (await store.read('along-at-owners', groupHex)).revision), revision);
  await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => backs), 2);
  await page.evaluate(async () => { window.view = mount(); await view.ready; });
  await page.getByRole('button', {name: 'Replace AT key', exact: true}).click();
  await page.getByRole('button', {name: 'Continue to replacement key'}).waitFor();
  await page.keyboard.press('Escape');
  await page.evaluate(async () => { window.view = mount(); await view.ready; });
  await page.getByRole('heading', {name: 'AT key saved on this device'}).waitFor();
  await page.getByRole('button', {name: 'Replace AT key', exact: true}).click();
  const proceed = page.getByRole('button', {name: 'Continue to replacement key'});
  await proceed.waitFor();
  await page.setViewportSize({width: 320, height: 640});
  await page.evaluate(() => document.documentElement.style.fontSize = '200%');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
  await page.evaluate(() => document.querySelector('.pairing-primary').click());
  await proceed.waitFor();
  await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  await page.getByRole('heading', {name: 'Add your replacement AT key'}).waitFor();
  // Leaving after the policy commit must not reactivate the previous key.
  await page.keyboard.press('Escape');
  await page.evaluate(async () => { window.view = mount(); await view.ready; });
  await page.getByRole('heading', {name: 'Add your replacement AT key'}).waitFor();
  await page.getByLabel('Personal AT API key').fill('synthetic-replacement-key');
  await page.getByRole('button', {name: 'Save key on this device'}).click();
  await page.getByRole('heading', {name: 'AT key saved on this device'}).waitFor();
  assert.equal(await page.evaluate(async () => {
    const {binding} = await (await import('./local-owner.mjs')).loadLocalATOwner({wasm, store, expectedGroup: group});
    const policy = await (await import('./policy-store.mjs')).openCredentialPolicyStore({store, ...binding}).read();
    const key = await (await import('./local-vault.mjs')).openLocalATVault({wasm, store, ...binding}).getKey();
    return policy.policy.generation === 2n && key === 'synthetic-replacement-key';
  }), true);
  await page.keyboard.press('Escape');
  // Replacing a loading screen must not let its late owner restore overwrite the successor.
  await page.evaluate(async () => {
    let release; const wait = new Promise(resolve => { release = resolve; });
    const old = mount({store: {...store, read: async (...args) => { await wait; return store.read(...args); }}});
    window.view = mount({store: {...store, read: async () => { throw new Error('unreadable'); }}});
    await view.ready; release(); await old.ready;
  });
  await page.getByRole('status').filter({hasText: 'could not be opened'}).waitFor();
  assert.equal(await page.getByRole('button', {name: 'Set up live information'}).count(), 0);
  await page.setViewportSize({width: 320, height: 640});
  await page.evaluate(() => document.documentElement.style.fontSize = '200%');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
  await page.evaluate(() => { view.dispose(); store.close(); });
  console.log('PASS: explicit keyboard owner setup -> actual encrypted key save -> Back -> restored settings, no synthetic-click setup or overwrite, Escape, unreadable state, replaced-view isolation, axe and enlarged narrow text. Synthetic key; public flow and peer delivery not enabled.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
