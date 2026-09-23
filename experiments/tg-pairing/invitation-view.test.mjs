import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const sources = new Map();
for (const name of ['storage.mjs', 'membership.mjs', 'certificate.mjs', 'invitation.mjs']) sources.set('/' + name, await readFile(join(process.env.R2_BROWSER_DIR, name)));
for (const name of ['software-persona.mjs', 'local-persona.mjs', 'software-invitation.mjs', 'invitation-view.mjs', 'comparison.css']) sources.set('/' + name, await readFile(new URL(name, import.meta.url)));
for (const name of ['hive_wasm.js', 'hive_wasm_bg.wasm']) sources.set('/' + name, await readFile(join(process.env.R2_WASM_DIR, name)));
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : req.url.endsWith('.wasm') ? 'application/wasm' : sources.has(req.url) ? 'text/javascript' : 'text/html');
  res.end(sources.get(req.url) || '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local setup</title><link rel="stylesheet" href="/comparison.css"></head><body><main><h1>Connect your devices</h1><div id="setup"></div></main></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const context = await browser.newContext({viewport: {width: 320, height: 640}, reducedMotion: 'reduce'});
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    window.wasm = await import('./hive_wasm.js'); await wasm.default();
    window.store = await (await import('./storage.mjs')).openBrowserStorage('invitation-view');
    const created = await (await import('./software-persona.mjs')).initializeSoftwarePersona({wasm, store});
    window.group = Uint8Array.from(created.group.match(/../g), value => parseInt(value, 16));
    window.module = await import('./invitation-view.mjs'); window.backCount = 0;
    window.mount = options => module.showSoftwareInvitation(document.querySelector('#setup'),
      {wasm, store, expectedGroup: group, focus: true, onBack: () => { backCount++; }, ...options});
    window.view = mount();
  });
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'H2');
  await page.evaluate(() => document.querySelector('.pairing-primary').click());
  assert.equal(await page.evaluate(() => !!view.currentInvitation()), false);
  await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  await page.getByRole('status').filter({hasText: 'Invitation ready'}).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Copy invitation');
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async value => { window.copied = value; }}});
  });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole('button', {name: 'Copy invitation', exact: true}).click();
  await page.getByRole('status').filter({hasText: 'Copied.'}).waitFor();
  assert.equal(await page.evaluate(() => copied === view.currentInvitation().descriptor), true);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async () => { throw new Error('Denied'); }}}));
  await page.getByRole('button', {name: 'Copy invitation', exact: true}).click();
  await page.getByRole('status').filter({hasText: 'Copy was unavailable'}).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'TEXTAREA');
  assert.equal(await page.getByLabel('Invitation text').inputValue(), await page.evaluate(() => view.currentInvitation().descriptor));
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.evaluate(() => { window.oldInvitation = view.currentInvitation(); });
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => backCount === 1 && oldInvitation.signal.aborted && !view.currentInvitation()), true);
  assert.equal(await page.getByLabel('Invitation text').inputValue(), '');
  // Expiry removes stale text and gives the keyboard a usable next action.
  await page.evaluate(() => { window.view = mount({lifetimeMs: 1000}); });
  await page.getByRole('button', {name: 'Create invitation', exact: true}).click();
  await page.getByRole('status').filter({hasText: 'Invitation ready'}).waitFor();
  await page.getByRole('status').filter({hasText: 'invitation has ended'}).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Create a new invitation');
  assert.equal(await page.evaluate(() => !!view.currentInvitation()), false);
  await page.getByRole('button', {name: 'Create a new invitation', exact: true}).click();
  await page.getByRole('status').filter({hasText: 'Invitation ready'}).waitFor();
  // A clipboard operation finishing after replacement cannot change its successor.
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable: true,
    value: {writeText: () => new Promise(resolve => { window.finishCopy = resolve; })}}));
  await page.getByRole('button', {name: 'Copy invitation', exact: true}).click();
  await page.evaluate(() => { window.oldInvitation = view.currentInvitation(); window.view = mount(); finishCopy(); });
  assert.equal(await page.evaluate(() => oldInvitation.signal.aborted), true);
  assert.equal(await page.getByRole('status').textContent(), '');
  // Cancellation during issuer restoration must not reveal a late invitation.
  await page.evaluate(() => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    window.releaseRead = release;
    window.view = mount({store: {...store, read: async (...args) => { await gate; return store.read(...args); }}});
  });
  await page.getByRole('button', {name: 'Create invitation', exact: true}).click();
  await page.getByRole('button', {name: 'Back', exact: true}).click();
  await page.evaluate(() => { document.querySelector('#setup').textContent = 'Returned to journeys'; releaseRead(); });
  assert.equal(await page.evaluate(() => !!view.currentInvitation()), false);
  await page.evaluate(async () => { await store.read('candidate-persona', 'active'); });
  assert.equal(await page.locator('#setup').textContent(), 'Returned to journeys');
  console.log('PASS: actual software invitation via keyboard; clipboard success/fallback, expiry/retry, Back/Escape and late-operation isolation; axe and 320px enlarged text. Clipboard is mocked; not a physical device connection.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
