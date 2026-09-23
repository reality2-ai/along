import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const sources = new Map(await Promise.all(['comparison.mjs', 'comparison.css'].map(async name => ['/' + name, await readFile(new URL('./' + name, import.meta.url))])));
const server = createServer((req, res) => {
  if (sources.has(req.url)) { res.writeHead(200, {'Content-Type': req.url.endsWith('.css') ? 'text/css' : 'text/javascript'}); res.end(sources.get(req.url)); }
  else {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pairing comparison fixture</title><link rel="stylesheet" href="/comparison.css"></head><body><main><h1>Connect your devices</h1><div id="comparison"></div></main></body></html>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
  const context = await browser.newContext({viewport: {width: 360, height: 780}, reducedMotion: 'reduce'});
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    const {showComparison} = await import('/comparison.mjs');
    window.setup = () => {
      window.controller?.abort(); window.controller = new AbortController(); window.calls = [];
      window.view = showComparison(document.querySelector('#comparison'), {code: new Uint8Array([0xA1, 0xB2, 0xC3, 0xD4]), focus: true, signal: controller.signal,
        onDecision: matched => { calls.push(matched); return new Promise((resolve, reject) => { window.complete = resolve; window.fail = reject; }); }});
    };
    setup();
  });
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'H2');
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
  assert.equal(await page.locator('.pairing-screen-reader').textContent(), 'Comparison code: A, 1; B, 2; C, 3; D, 4.');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].every(button => Math.abs(button.getBoundingClientRect().width - document.querySelector('.pairing-code').getBoundingClientRect().width) < 1)), true);
  await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  await page.evaluate(() => document.querySelector('.pairing-primary').click());
  assert.deepEqual(await page.evaluate(() => calls), [true]);
  assert.equal(await page.locator('button:disabled').count(), 2);
  await page.evaluate(() => complete());
  await page.getByRole('status').filter({hasText: 'Enrollment is not yet complete.'}).waitFor();
  await page.evaluate(() => setup());
  await page.keyboard.press('Escape');
  assert.deepEqual(await page.evaluate(() => calls), [false]);
  await page.evaluate(() => complete());
  await page.getByRole('status').filter({hasText: 'was cancelled'}).waitFor();
  await page.evaluate(() => setup());
  await page.getByRole('button', {name: 'Both devices are here and the codes match'}).click();
  await page.evaluate(() => { controller.abort(); complete(); });
  await page.getByRole('status').filter({hasText: 'comparison has ended'}).waitFor();
  await page.evaluate(() => setup());
  await page.getByRole('button', {name: 'Both devices are here and the codes match'}).click();
  await page.evaluate(() => fail(new Error('synthetic')));
  await page.getByRole('status').filter({hasText: 'Could not finish'}).waitFor();
  await page.evaluate(() => { setup(); document.documentElement.style.fontSize = '200%'; });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; setup(); });
  await page.screenshot({path: '/tmp/along-pairing-comparison.png', fullPage: true});
  console.log('PASS: narrow-screen comparison has full-width actions, readable code text, keyboard match/cancel, one decision only, expiration overriding a pending result, recoverable failure, 200% text reflow and no automated axe violations. Spoken screen-reader use is not established.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
