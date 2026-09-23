// Actual browser-software issuer and core enrollment; harness supplies initial trust and signaling.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const root = process.env.PAIRING_LAB_DIR || new URL('../../releases/along-pairing-lab/', import.meta.url).pathname;
const manifest = JSON.parse(await readFile(join(root, 'build-info.json'), 'utf8'));
const prefix = '/along/pairing-lab/';
assert.equal(manifest.profile, 'along-pairing-lab-v1');
assert.equal(Object.keys(manifest.files).some(name => /APIKey|\.test\.|data\//.test(name)), false);
const sources = new Map(await Promise.all(Object.entries(manifest.files).map(async ([name, hash]) => {
  const bytes = await readFile(join(root, name));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hash);
  return ['/' + name, bytes];
}))); 
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.startsWith(prefix) ? '/' + (url.pathname.slice(prefix.length) || 'index.html') : '';
  const body = path === '/build-info.json' ? JSON.stringify(manifest) : sources.get(path);
  if (!body) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : path.endsWith('.css') ? 'text/css' : path.endsWith('.html') ? 'text/html' : 'text/javascript');
  res.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH,
    ...(process.env.CHECK_BFCACHE === '1' ? {ignoreDefaultArgs: ['--disable-back-forward-cache']} : {})});
  const contexts = await Promise.all([browser.newContext({viewport: {width: 360, height: 780}}), browser.newContext({viewport: {width: 360, height: 780}})]);
  const pages = await Promise.all(contexts.map(c => c.newPage()));
  const externalRequests = [];
  await Promise.all(contexts.map(context => context.route('**/*', route => {
    if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue();
    externalRequests.push(route.request().url()); return route.abort();
  })));
  await Promise.all(pages.map(async (page, index) => {
    await page.goto(`http://127.0.0.1:${server.address().port}${prefix}`);
    assert.equal(await page.locator('#lab-build').textContent(), 'Lab build ' + manifest.build_id);
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
  for (const page of pages) {
    await page.setViewportSize({width: 320, height: 640});
    await page.evaluate(() => document.documentElement.style.fontSize = '200%');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
  }
  assert.equal(await candidate.locator('.pairing-code').textContent(), await owner.locator('.pairing-code').textContent());

  await Promise.all(pages.map(async page => {
    await page.getByRole('button', {name: 'Both devices are here and the codes match', exact: true}).click();
  }));
  await candidate.getByRole('heading', {name: 'Device connected', exact: true}).waitFor();
  await owner.getByRole('heading', {name: 'Other device installed', exact: true}).waitFor();
  const target = await owner.evaluate(async () => {
    const store = await (await import('./tg-pairing/storage.mjs')).openBrowserStorage('along-pairing-lab-v1');
    try { return [...(await store.read('candidate-persona', 'active')).value.record.group]; } finally { store.close(); }
  });
  assert.equal(await candidate.evaluate(async group => {
    const wasm = await import('./tg-pairing/hive_wasm.js'); await wasm.default();
    const store = await (await import('./tg-pairing/storage.mjs')).openBrowserStorage('along-pairing-lab-v1');
    const restored = await (await import('./tg-pairing/local-persona.mjs')).loadLocalPersona({wasm, store, expectedGroup: new Uint8Array(group)});
    const traffic = await (await import('./tg-pairing/software-traffic.mjs')).loadSoftwareTraffic({wasm, store, expectedGroup: new Uint8Array(group)});
    traffic.destroy(); store.close(); return restored.origin === 'enrolled' && restored.peerAcknowledged;
  }, target), true);
  await Promise.all(pages.map(page => page.reload()));
  await Promise.all(pages.map(page => page.getByRole('button', {name: 'Restore saved test device', exact: true}).click()));
  await candidate.getByText('This device has joined a group and received installation confirmation.', {exact: true}).waitFor();
  assert.equal(await candidate.getByRole('button', {name: 'Recover installation confirmation', exact: true}).count(), 0);
  await owner.getByRole('button', {name: 'Confirm an interrupted connection', exact: true}).click();
  await owner.getByRole('heading', {name: 'Confirm an interrupted connection', exact: true}).waitFor();
  await owner.getByRole('button', {name: 'Back', exact: true}).click();
  await owner.getByRole('button', {name: 'Restore saved test device', exact: true}).click();
  await candidate.getByRole('button', {name: 'Test optional AT-key storage', exact: true}).click();
  await candidate.getByRole('button', {name: 'Set up live information', exact: true}).click();
  await candidate.getByLabel('Personal AT API key', {exact: true}).fill('synthetic-built-lab-key');
  await candidate.getByRole('button', {name: 'Save key on this device', exact: true}).click();
  await candidate.getByRole('heading', {name: 'AT key saved on this device', exact: true}).waitFor();
  assert.equal((await candidate.locator('body').textContent()).includes('synthetic-built-lab-key'), false);
  assert.deepEqual((await new AxeBuilder({page: candidate}).analyze()).violations.map(v => v.id), []);
  await candidate.reload();
  await candidate.getByRole('button', {name: 'Restore saved test device', exact: true}).click();
  await candidate.getByRole('button', {name: 'Test optional AT-key storage', exact: true}).click();
  await candidate.getByRole('heading', {name: 'AT key saved on this device', exact: true}).waitFor();
  assert.equal(await candidate.evaluate(async () => {
    const wasm = await import('./tg-pairing/hive_wasm.js'); await wasm.default();
    const store = await (await import('./tg-pairing/storage.mjs')).openBrowserStorage('along-pairing-lab-v1');
    try {
      const persona = await store.read('candidate-persona', 'active');
      const {binding, role} = await (await import('./at-credentials/local-owner.mjs')).loadATBinding({wasm, store, expectedGroup: persona.value.record.group});
      const vault = (await import('./at-credentials/local-vault.mjs')).openLocalATVault({wasm, store, ...binding});
      const saved = await store.read('along-at-secret:' + binding.owner, binding.group + ':' + binding.credential);
      return role === 'owner' && saved.value.wrappingKey.extractable === false
        && saved.value.ciphertext instanceof Uint8Array
        && !JSON.stringify(saved.value, (_, value) => typeof value === 'bigint' ? value.toString() : value).includes('synthetic-built-lab-key')
        && await vault.getKey() === 'synthetic-built-lab-key';
    } finally { store.close(); }
  }), true);
  assert.deepEqual(externalRequests, []);
  await candidate.getByRole('button', {name: 'Back', exact: true}).click();
  await candidate.getByRole('button', {name: 'Remove this test device data…', exact: true}).click();
  assert.deepEqual((await new AxeBuilder({page: candidate}).analyze()).violations.map(v => v.id), []);
  await candidate.getByRole('button', {name: 'Keep this test device', exact: true}).click();
  await candidate.getByRole('button', {name: 'Restore saved test device', exact: true}).waitFor();
  await candidate.evaluate(async () => {
    localStorage.setItem('along-journeys-v1', 'journey sentinel');
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('along-offline', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('timetable');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('timetable', 'readwrite');
        tx.objectStore('timetable').put('schedule sentinel', 'test');
        tx.oncomplete = () => { db.close(); resolve(); };
      };
    });
    window.blocker = await new Promise((resolve, reject) => {
      const request = indexedDB.open('r2-browser:along-pairing-lab-v1');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  });
  await candidate.getByRole('button', {name: 'Remove this test device data…', exact: true}).click();
  await candidate.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Remove this test device data').click());
  assert.equal(await candidate.getByRole('heading', {name: 'Remove this test device?', exact: true}).count(), 1);
  assert.equal(await candidate.getByRole('status').textContent(), '');
  await candidate.getByRole('button', {name: 'Remove this test device data', exact: true}).focus();
  await candidate.keyboard.press('Enter');
  await candidate.getByRole('status').filter({hasText: 'Removal is waiting'}).waitFor();
  assert.equal(await candidate.getByRole('button', {name: 'Keep this test device', exact: true}).count(), 0);
  assert.equal(await candidate.getByRole('button', {name: 'Return to setup', exact: true}).count(), 0);
  await candidate.evaluate(() => blocker.close());
  await candidate.getByRole('heading', {name: 'Test device data removed', exact: true}).waitFor();
  assert.equal(await candidate.evaluate(() => document.activeElement.textContent), 'Return to setup');
  assert.equal(await candidate.evaluate(async () => {
    if (localStorage.getItem('along-journeys-v1') !== 'journey sentinel') return false;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('along-offline', 1);
      request.onsuccess = () => {
        const db = request.result, read = db.transaction('timetable').objectStore('timetable').get('test');
        read.onsuccess = () => { db.close(); resolve(read.result === 'schedule sentinel'); };
      }; request.onerror = () => reject(request.error);
    });
  }), true);
  await candidate.getByRole('button', {name: 'Return to setup', exact: true}).click();
  await candidate.getByRole('button', {name: 'Set up this test device', exact: true}).waitFor();
  assert.equal(await owner.getByRole('button', {name: 'Invite my other device', exact: true}).count(), 1);
  if (process.env.CHECK_BFCACHE === '1') {
    const token = await owner.evaluate(() => {
      window.documentToken = crypto.randomUUID();
      window.cachedReturn = false;
      window.addEventListener('pageshow', event => { if (event.persisted) window.cachedReturn = true; });
      return window.documentToken;
    });
    await owner.goto(`http://127.0.0.1:${server.address().port}${prefix}build-info.json`);
    await owner.goBack({waitUntil: 'commit'});
    await owner.waitForFunction(() => window.cachedReturn || !window.documentToken);
    assert.deepEqual(await owner.evaluate(() => [window.documentToken, window.cachedReturn]), [token, true]);
    await owner.getByRole('button', {name: 'Restore saved test device', exact: true}).click();
    await owner.getByRole('button', {name: 'Invite my other device', exact: true}).waitFor();
    console.log('PASS: real browser Back revives the same cached lab document and restores usable saved-device controls.');
  }
  assert.deepEqual(externalRequests, []);
  console.log('PASS: actual enrolled device -> AT settings -> encrypted synthetic key save -> reload/restore; no external requests or displayed key.');
  console.log('PASS: explicit lab reset, cancel, synthetic-click refusal, blocked deletion and completed removal; Along journey preferences and offline database preserved.');
  console.log('PASS: standalone static lab setup, pairing and reload/restore; both complete pairing flows exchange public messages through fields, compare codes, enroll over real WebRTC, acknowledge installation and restore encrypted traffic keys. Harness transfers text and confirms codes; no physical-device usability claim.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
