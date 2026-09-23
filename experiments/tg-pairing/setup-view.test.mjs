import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const sources = new Map();
for (const name of ['storage.mjs', 'membership.mjs', 'certificate.mjs']) sources.set('/' + name, await readFile(join(process.env.R2_BROWSER_DIR, name)));
for (const name of ['initial-persona.mjs', 'setup-view.mjs', 'comparison.css']) sources.set('/' + name, await readFile(new URL(name, import.meta.url)));
for (const name of ['hive_wasm.js', 'hive_wasm_bg.wasm']) sources.set('/' + name, await readFile(join(process.env.R2_WASM_DIR, name)));
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : req.url.endsWith('.wasm') ? 'application/wasm' : sources.has(req.url) ? 'text/javascript' : 'text/html');
  res.end(sources.get(req.url) || '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local setup</title><link rel="stylesheet" href="/comparison.css"></head><body><main><h1>Connect your devices</h1><div id="setup"></div></main></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const context = await browser.newContext({viewport: {width: 360, height: 780}, reducedMotion: 'reduce'});
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    window.wasm = await import('./hive_wasm.js'); await wasm.default();
    window.store = await (await import('./storage.mjs')).openBrowserStorage('setup-view');
    window.module = await import('./setup-view.mjs'); window.backCount = 0;
    window.mount = options => module.showLocalSetup(document.querySelector('#setup'),
      {wasm, store, focus: true, onBack: () => { backCount++; }, ...options});
    window.view = mount(); await view.ready;
  });
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'H2');
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
  await page.evaluate(() => document.querySelector('.pairing-primary').click());
  assert.equal(await page.evaluate(() => store.read('candidate-persona', 'active')), null);
  await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  await page.getByRole('heading', {name: 'Device identity saved'}).waitFor();
  assert.equal(await page.getByRole('button', {name: 'Create a device identity'}).count(), 0);
  assert.equal(await page.evaluate(async () => (await view.completed).issuerAvailable()), true);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Back');
  await page.getByRole('button', {name: 'Back', exact: true}).click();
  assert.equal(await page.evaluate(() => backCount), 1);
  assert.equal(await page.evaluate(async () => (await view.completed).issuerAvailable()), false);
  await page.evaluate(async () => { window.view = mount(); await view.ready; });
  await page.getByRole('heading', {name: 'Saved device state found'}).waitFor();
  assert.equal(await page.getByRole('button', {name: 'Create a device identity'}).count(), 0);
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
  await page.setViewportSize({width: 320, height: 640});
  await page.evaluate(() => document.documentElement.style.fontSize = '200%');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => backCount), 2);
  await page.evaluate(async () => {
    window.view = mount({store: {read: async () => { throw new Error('controlled failure'); }}}); await view.ready;
  });
  await page.getByRole('status').filter({hasText: 'could not be read'}).waitFor();
  assert.equal(await page.getByRole('button', {name: 'Create a device identity'}).count(), 0);
  // A replaced view cannot reveal a late Create action over its successor.
  await page.evaluate(async () => {
    let release;
    const wait = new Promise(resolve => { release = resolve; });
    const old = mount({store: {read: async () => { await wait; return null; }}});
    window.view = mount(); await view.ready; release(); await old.ready;
  });
  await page.getByRole('heading', {name: 'Saved device state found'}).waitFor();
  assert.equal(await page.getByRole('button', {name: 'Create a device identity'}).count(), 0);
  console.log('PASS: real keyboard-activated setup, no synthetic-click creation, no repeat creation, Back/Escape custody disposal, read-failure and replaced-view refusal, axe and narrow enlarged-text checks. Not a TalkBack or physical-device check.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
