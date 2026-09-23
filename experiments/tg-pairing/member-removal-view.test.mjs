import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const sources = new Map();
for (const name of ['storage.mjs', 'membership.mjs', 'certificate.mjs']) sources.set('/' + name, await readFile(join(process.env.R2_BROWSER_DIR, name)));
for (const name of ['software-persona.mjs', 'local-persona.mjs', 'member-removal.mjs', 'member-removal-view.mjs', 'comparison.css']) sources.set('/' + name, await readFile(new URL(name, import.meta.url)));
for (const name of ['hive_wasm.js', 'hive_wasm_bg.wasm']) sources.set('/' + name, await readFile(join(process.env.R2_WASM_DIR, name)));
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : req.url.endsWith('.wasm') ? 'application/wasm' : sources.has(req.url) ? 'text/javascript' : 'text/html');
  res.end(sources.get(req.url) || '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Device removal review</title><link rel="stylesheet" href="/comparison.css"></head><body><main><h1>Connect your devices</h1><div id="setup"></div></main></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const context = await browser.newContext({viewport: {width: 320, height: 720}, reducedMotion: 'reduce'});
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    window.wasm = await import('./hive_wasm.js'); await wasm.default();
    window.store = await (await import('./storage.mjs')).openBrowserStorage('removal-view');
    const software = await import('./software-persona.mjs');
    const identity = await software.initializeSoftwarePersona({wasm, store});
    window.groupId = identity.group;
    window.group = Uint8Array.from(identity.group.match(/../g), b => parseInt(b, 16));
    const issuer = await software.loadSoftwareIssuer({wasm, store, expectedGroup: group});
    window.peer = crypto.getRandomValues(new Uint8Array(32)); window.certificate = await issuer.issueCertificate(peer); issuer.close();
    window.module = await import('./member-removal-view.mjs'); window.backCount = 0;
    window.mount = options => module.showMemberRemoval(document.querySelector('#setup'),
      {wasm, store, expectedGroup: group, subject: peer, certificate, focus: true, onBack: () => { backCount++; }, ...options});
    window.view = mount(); await view.ready;
  });
  const count = () => page.evaluate(async () => (await store.read('membership', groupId)).value.revocations.length);
  const action = page.getByRole('button', {name: 'Save device removal here', exact: true});
  await action.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'H2');
  await page.evaluate(() => document.documentElement.style.fontSize = '200%');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
  await page.evaluate(() => document.documentElement.style.fontSize = '');
  await page.evaluate(() => document.querySelector('.pairing-primary').click());
  assert.equal(await count(), 0);
  await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => backCount), 1);
  assert.equal(await count(), 0);
  await page.evaluate(async () => { window.view = mount(); await view.ready; });
  await page.getByRole('button', {name: 'Back', exact: true}).click(); assert.equal(await count(), 0);
  await page.evaluate(async () => { window.view = mount(); await view.ready; });
  await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  await page.getByRole('heading', {name: 'Device removal saved here', exact: true}).waitFor();
  assert.equal(await count(), 1);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Back');
  assert.equal(await page.evaluate(async () => (await view.completed).delivered), false);
  await page.getByRole('status').filter({hasText: 'has not been delivered'}).waitFor();
  await page.evaluate(async () => { window.view = mount(); await view.ready; });
  await page.getByRole('heading', {name: 'Device removal already saved here'}).waitFor();
  assert.equal(await action.count(), 0);
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
  // A failed review and a late review completion cannot expose a removal action.
  await page.evaluate(async () => {
    const bad = certificate.slice(); bad[135] ^= 1;
    window.view = mount({certificate: bad}); await view.ready;
  });
  await page.getByRole('status').filter({hasText: 'could not be reviewed'}).waitFor();
  assert.equal(await action.count(), 0);
  await page.evaluate(async () => {
    let release; const gate = new Promise(resolve => { release = resolve; });
    const old = mount({store: {...store, read: async (...args) => { await gate; return store.read(...args); }}});
    window.view = mount(); await view.ready; release(); await old.ready;
  });
  await page.getByRole('heading', {name: 'Device removal already saved here'}).waitFor();
  assert.equal(await count(), 1);
  for (const afterCommit of [false, true]) {
    const before = await count();
    await page.evaluate(async afterCommit => {
      const issuer = await (await import('./software-persona.mjs')).loadSoftwareIssuer({wasm, store, expectedGroup: group});
      const subject = crypto.getRandomValues(new Uint8Array(32)), proof = await issuer.issueCertificate(subject); issuer.close();
      window.saveReached = false;
      const gate = new Promise(resolve => { window.releaseSave = resolve; });
      window.saveFinished = new Promise(resolve => { window.finishSave = resolve; });
      const delayed = {...store, compareAndSwapMany: async (...args) => {
        try {
          const result = afterCommit ? await store.compareAndSwapMany(...args) : null;
          window.saveReached = true; await gate;
          return afterCommit ? result : await store.compareAndSwapMany(...args);
        } finally { finishSave(); }
      }};
      window.view = mount({store: delayed, subject, certificate: proof}); await view.ready;
    }, afterCommit);
    await action.click(); await page.waitForFunction(() => saveReached);
    await page.getByRole('button', {name: 'Back', exact: true}).click();
    await page.evaluate(() => document.querySelector('#setup').textContent = 'Returned to journeys');
    await page.evaluate(async () => { releaseSave(); await saveFinished; });
    assert.equal(await count(), before + Number(afterCommit));
    assert.equal(await page.locator('#setup').textContent(), 'Returned to journeys');
  }
  console.log('PASS: removal review uses real issuer and membership, keyboard confirmation, Back/Escape and synthetic-click refusal; saved/undelivered wording, repeated removal, stale view, 320px/200% layout and axe checks pass. No physical screen-reader or complete app-flow claim.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
