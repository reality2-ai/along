import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import('@playwright/test');
const sources = new Map();
for (const name of ['storage.mjs', 'membership.mjs', 'certificate.mjs']) sources.set('/' + name, await readFile(join(process.env.R2_BROWSER_DIR, name)));
for (const name of ['software-persona.mjs', 'local-persona.mjs', 'epoch-preparation.mjs', 'epoch-recovery-material.mjs', 'epoch-transition.mjs', 'epoch-installation.mjs', 'epoch-watch.mjs', 'software-traffic.mjs', 'member-removal.mjs', 'epoch-rotation-view.mjs', 'comparison.css']) sources.set('/' + name, await readFile(new URL(name, import.meta.url)));
for (const name of ['hive_wasm.js', 'hive_wasm_bg.wasm']) sources.set('/' + name, await readFile(join(process.env.R2_WASM_DIR, name)));
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : req.url.endsWith('.wasm') ? 'application/wasm' : sources.has(req.url) ? 'text/javascript' : 'text/html');
  res.end(sources.get(req.url) || '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Group key update</title><link rel="stylesheet" href="/comparison.css"></head><body><main><h1>Your devices</h1><div id="setup"></div></main></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const context = await browser.newContext({viewport: {width: 320, height: 720}, reducedMotion: 'reduce'});
  const page = await context.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`);
  const setup = async () => page.evaluate(async () => {
    window.wasm = await import('./hive_wasm.js'); await wasm.default();
    window.store = await (await import('./storage.mjs')).openBrowserStorage('rotation-view');
    window.software = await import('./software-persona.mjs');
    let saved = await store.read('candidate-persona', 'active');
    if (!saved) { await software.initializeSoftwarePersona({wasm, store}); saved = await store.read('candidate-persona', 'active'); }
    window.group = saved.value.record.group;
    window.groupId = Array.from(group, b => b.toString(16).padStart(2, '0')).join('');
    window.module = await import('./epoch-rotation-view.mjs'); window.backCount = 0;
    window.mount = options => module.showEpochRotation(document.querySelector('#setup'), {
      wasm, store, expectedGroup: group, focus: true, onBack: () => { backCount++; }, ...options});
    window.view = mount(); await view.ready;
  });
  await setup();
  const epoch = () => page.evaluate(async () => String((await store.read('candidate-persona', 'active')).value.epoch));
  const action = page.getByRole('button', {name: 'Update keys on this device', exact: true});
  await action.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'H2');
  await page.evaluate(() => document.documentElement.style.fontSize = '200%');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
  await page.evaluate(() => document.documentElement.style.fontSize = '');
  await page.evaluate(() => document.querySelector('.pairing-primary').click()); assert.equal(await epoch(), '0');
  await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => backCount), 1); assert.equal(await epoch(), '0');
  await page.evaluate(async () => { window.view = mount(); await view.ready; });
  await page.getByRole('button', {name: 'Back', exact: true}).click(); assert.equal(await epoch(), '0');
  await page.evaluate(async () => { window.view = mount(); await view.ready; });
  await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  await page.getByRole('heading', {name: 'Group keys updated on this device', exact: true}).waitFor();
  assert.equal(await epoch(), '1');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Back');
  assert.equal(await page.evaluate(async () => (await view.completed).delivered), false);
  await page.getByRole('status').filter({hasText: 'does not confirm that any other device'}).waitFor();
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
  await page.reload(); await setup();
  await page.getByRole('status').filter({hasText: 'uses key version 1'}).waitFor();
  // An independent operation advances while the old review remains visible.
  await page.evaluate(async () => {
    const issuer = await software.loadSoftwareIssuer({wasm, store, expectedGroup: group});
    await issuer.prepareRotation(); issuer.close();
    await (await import('./epoch-installation.mjs')).installPreparedIssuerEpoch({wasm, store, expectedGroup: group, epoch: 2n});
  });
  await action.click(); await page.getByRole('status').filter({hasText: 'could not be confirmed'}).waitFor();
  assert.equal(await epoch(), '2', 'old review cannot approve a different successor');
  assert.equal(await page.evaluate(async () => !!await store.read('along-prepared-epoch-v1', groupId + ':3')), false);
  // An obsolete asynchronous review must not replace a newer mounted screen.
  await page.evaluate(async () => {
    let release; const gate = new Promise(resolve => { release = resolve; });
    const old = mount({store: {...store, read: async (...args) => { await gate; return store.read(...args); }}});
    window.view = mount(); await view.ready; release(); await old.ready;
  });
  await page.getByRole('status').filter({hasText: 'uses key version 2'}).waitFor();
  for (const afterCommit of [false, true]) {
    const before = Number(await epoch());
    await page.evaluate(async afterCommit => {
      window.saveReached = false;
      const gate = new Promise(resolve => { window.releaseSave = resolve; });
      window.saveFinished = new Promise(resolve => { window.finishSave = resolve; });
      const delayed = {...store, compareAndSwapMany: async (writes, options) => {
        if (!writes.some(write => write.scope === 'along-installed-epoch-v1')) return store.compareAndSwapMany(writes, options);
        try {
          const result = afterCommit ? await store.compareAndSwapMany(writes, options) : null;
          saveReached = true; await gate;
          return afterCommit ? result : await store.compareAndSwapMany(writes, options);
        } finally { finishSave(); }
      }};
      window.view = mount({store: delayed}); await view.ready;
    }, afterCommit);
    await action.click(); await page.waitForFunction(() => saveReached);
    await page.getByRole('button', {name: 'Back', exact: true}).click();
    await page.evaluate(() => document.querySelector('#setup').textContent = 'Returned to journeys');
    await page.evaluate(async () => { releaseSave(); await saveFinished; });
    assert.equal(Number(await epoch()), before + Number(afterCommit), 'Back preserves the transaction boundary');
    assert.equal(await page.locator('#setup').textContent(), 'Returned to journeys');
  }
  // Unreadable custody must not offer an update or silently recreate identity.
  await page.evaluate(async () => {
    window.view = mount({store: {...store, read: async (scope, key) => {
      if (scope === 'along-browser-issuer') throw Error('Unreadable fixture'); return store.read(scope, key);
    }}}); await view.ready;
  });
  await page.getByRole('status').filter({hasText: 'could not be reviewed'}).waitFor();
  assert.equal(await action.count(), 0); assert.equal(await epoch(), '3');
  console.log('PASS: real issuer key-update review, keyboard confirmation, synthetic-click refusal, Back/Escape, fresh-document version, stale approval refusal, pre/post-commit cancellation, obsolete view, unreadable custody, narrow/200% layout and axe checks. Local success never claims peer delivery; no physical screen-reader or complete recovery-flow claim.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
