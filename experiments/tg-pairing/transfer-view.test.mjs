import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const sources = new Map();
for (const name of ['transfer-view.mjs', 'comparison.css']) sources.set('/' + name, await readFile(new URL(name, import.meta.url)));
for (const name of ['qr-transfer.mjs', 'vendor/qrcode.mjs']) sources.set('/' + name, await readFile(new URL(name, import.meta.url)));
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : req.url.endsWith('.wasm') ? 'application/wasm' : sources.has(req.url) ? 'text/javascript' : 'text/html');
  res.end(sources.get(req.url) || '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local setup</title><link rel="stylesheet" href="/comparison.css"></head><body><main><h1>Connect your devices</h1><div id="setup"></div></main></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const context = await browser.newContext({viewport: {width: 320, height: 640}, reducedMotion: 'reduce'});
  const page = await context.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    window.module = await import('./transfer-view.mjs'); window.calls = 0; window.backCount = 0;
    window.mount = options => module.showDeviceTransfer(document.querySelector('#setup'), {
      title: 'Check your other device', explanation: 'Copy the challenge, then paste the reply from your other device.',
      outgoing: 'public challenge', focus: true, onBack: () => { backCount++; },
      onReceive: async (value, signal) => { calls++; window.received = {value, signal}; }, ...options});
    window.view = mount();
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async value => { window.copied = value; }}});
  });
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'H2');
  await page.getByRole('button', {name: 'Show QR code', exact: true}).click();
  await page.getByRole('img', {name: 'Device message QR code. Copyable text is also available.', exact: true}).waitFor();
  await page.getByRole('heading', {name: 'Check your other device', exact: true}).focus();
  await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  await page.getByRole('status').filter({hasText: 'Copied.'}).waitFor();
  assert.equal(await page.evaluate(() => copied), 'public challenge');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async () => { throw new Error('Denied'); }}}));
  await page.getByRole('button', {name: 'Copy device message'}).click();
  await page.getByRole('status').filter({hasText: 'Copy was unavailable'}).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'TEXTAREA');
  await page.getByRole('button', {name: 'Check reply'}).click();
  assert.equal(await page.evaluate(() => calls), 0);
  await page.getByLabel('Reply from your other device').fill('public reply');
  assert.equal(await page.getByRole('button', {name: 'Check reply'}).getAttribute('class'), 'pairing-primary');
  await page.evaluate(() => document.querySelector('.pairing-primary').click());
  assert.equal(await page.evaluate(() => calls), 0);
  await page.evaluate(() => document.documentElement.style.fontSize = '200%');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
  await page.getByRole('button', {name: 'Check reply'}).focus(); await page.keyboard.press('Enter');
  await page.getByRole('status').filter({hasText: 'Device message checked'}).waitFor();
  assert.equal(await page.evaluate(() => calls === 1 && received.value === 'public reply'), true);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Back');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => backCount === 1 && received.signal.aborted), true);
  // A late callback cannot replace the successor or announce success after Back.
  await page.evaluate(() => { window.view = mount({onReceive: async (value, signal) => {
    window.pendingSignal = signal; await new Promise(resolve => { window.finish = resolve; });
  }}); });
  await page.getByLabel('Reply from your other device').fill('late reply');
  await page.getByRole('button', {name: 'Check reply'}).click();
  await page.getByRole('button', {name: 'Back', exact: true}).click();
  await page.evaluate(() => { window.view = mount(); finish(); });
  assert.equal(await page.evaluate(() => pendingSignal.aborted), true);
  assert.equal(await page.getByRole('status').textContent(), '');
  await page.evaluate(() => { window.view = mount({onReceive: async () => { throw new Error('Refused'); }}); });
  await page.getByLabel('Reply from your other device').fill('invalid reply');
  await page.getByRole('button', {name: 'Check reply'}).click();
  await page.getByRole('status').filter({hasText: 'could not be accepted'}).waitFor();
  assert.equal(await page.evaluate(() => view.signal.aborted), true);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Back');
  assert.equal(await page.locator('[aria-busy]').count(), 0);
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
  await page.evaluate(() => { const abort = new AbortController(); abort.abort(); window.view = mount({signal: abort.signal}); });
  assert.equal(await page.getByRole('button', {name: 'Check reply'}).count(), 0);
  assert.equal(await page.evaluate(() => view.signal.aborted), true);
  console.log('PASS: transfer keyboard/copy fallback, next-action emphasis, synthetic-click refusal, single submission, cancellation and late completion, refusal, axe and narrow enlarged text. Clipboard mocked; protocol integration checked separately.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
