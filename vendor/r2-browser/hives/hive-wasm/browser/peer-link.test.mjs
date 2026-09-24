// Two isolated browser contexts; signalling is copied by this test harness only.
// No connection description, candidate address or credential is logged/saved.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const source = await readFile(new URL('./peer-link.mjs', import.meta.url));
const server = createServer((req, res) => {
  if (req.url === '/peer-link.mjs') { res.writeHead(200, {'Content-Type': 'text/javascript'}); res.end(source); }
  else { res.writeHead(200, {'Content-Type': 'text/html'}); res.end('<!doctype html><title>Peer transport test</title>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
  const a = await browser.newContext(), b = await browser.newContext();
  const pages = await Promise.all([a.newPage(), b.newPage()]);
  await Promise.all(pages.map(async (page, index) => {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(async role => {
      const {createPeerLink} = await import('./peer-link.mjs');
      window.received = []; window.linkClosed = false;
      window.link = createPeerLink({role, onMessage: text => window.received.push(text), onClose: () => { window.linkClosed = true; }});
    }, index === 0 ? 'offer' : 'answer');
  }));
  // The asset host is gone before negotiation and data exchange begin.
  await new Promise(resolve => server.close(resolve));
  const [left, right] = pages;
  const beforeOpen = await left.evaluate(() => { try { window.link.send('early'); return false; } catch { return true; } });
  assert.equal(beforeOpen, true);
  const offer = await left.evaluate(() => window.link.offer());
  const answer = await right.evaluate(offer => window.link.accept(offer), offer);
  await left.evaluate(answer => window.link.accept(answer), answer);
  await Promise.all(pages.map(page => page.evaluate(() => window.link.opened())));
  const hashes = await Promise.all(pages.map(page => page.evaluate(async () => [...await window.link.transcript()])));
  assert.equal(hashes[0].length, 32); assert.deepEqual(hashes[0], hashes[1]);
  await left.evaluate(() => { window.link.send('synthetic one'); window.link.send('synthetic two'); });
  await right.waitForFunction(() => window.received.length === 2);
  assert.deepEqual(await right.evaluate(() => window.received), ['synthetic one', 'synthetic two']);
  await right.evaluate(() => window.link.send('synthetic reply'));
  await left.waitForFunction(() => window.received.length === 1);
  assert.deepEqual(await left.evaluate(() => window.received), ['synthetic reply']);
  const oversized = await left.evaluate(() => { try { window.link.send('x'.repeat(16385)); return false; } catch { return true; } });
  assert.equal(oversized, true);
  await left.evaluate(() => window.link.close());
  await right.waitForFunction(() => window.linkClosed);
  const afterClose = await right.evaluate(() => { try { window.link.send('late'); return false; } catch { return true; } });
  assert.equal(afterClose, true);
  console.log('PASS: with the asset server stopped, isolated browser contexts exchange ordered messages through a direct data channel; transcript hashes agree; early, oversized and closed sends refuse; peer closure propagates.');
} finally { await browser?.close(); if (server.listening) await new Promise(resolve => server.close(resolve)); }
