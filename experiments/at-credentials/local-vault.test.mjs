import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const sources = new Map();
for (const name of ['storage.mjs', 'membership.mjs', 'certificate.mjs']) sources.set('/' + name, await readFile(join(process.env.R2_BROWSER_DIR, name)));
for (const name of ['../tg-pairing/initial-persona.mjs', '../tg-pairing/local-persona.mjs', 'local-owner.mjs', 'policy.mjs', 'policy-store.mjs', 'local-vault.mjs', 'delivery-message.mjs']) sources.set('/' + name.split('/').pop(), await readFile(new URL(name, import.meta.url)));
for (const name of ['hive_wasm.js', 'hive_wasm_bg.wasm']) sources.set('/' + name, await readFile(join(process.env.R2_WASM_DIR, name)));
for (const name of ['live-client.mjs', '../../public/at-client.js', '../../public/live-client.js']) sources.set('/' + name.split('/').pop(), await readFile(new URL(name, import.meta.url)));
const server = createServer((req, res) => {
  const path = '/' + req.url.split('/').pop();
  res.setHeader('Content-Type', req.url.endsWith('.wasm') ? 'application/wasm' : sources.has(path) ? 'text/javascript' : 'text/html');
  res.end(sources.get(path) || '<!doctype html><title>First-use test</title>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const context = await browser.newContext(), page = await context.newPage();
  const url = `http://127.0.0.1:${server.address().port}`; await page.goto(url);
  const binding = await page.evaluate(async () => {
    window.wasm = await import('./hive_wasm.js'); await wasm.default();
    window.store = await (await import('./storage.mjs')).openBrowserStorage('local-at-vault');
    const initial = await (await import('./initial-persona.mjs')).initializeLocalPersona({wasm, store}); initial.close();
    const group = (await store.read('candidate-persona', 'active')).value.record.group;
    window.binding = (await (await import('./local-owner.mjs')).establishLocalATOwner({wasm, store, expectedGroup: group})).binding;
    window.vaultModule = await import('./local-vault.mjs');
    window.vault = vaultModule.openLocalATVault({wasm, store, ...binding});
    const check = (v, why) => { if (!v) throw new Error(why); };
    const refused = async fn => { try { await fn(); return false; } catch { return true; } };
    check(await refused(() => vault.getKey()), 'missing key refuses');
    check(JSON.stringify(await vault.inspect()) === JSON.stringify({status: 'missing', canSave: true}), 'missing status');
    const saved = await vault.saveOwnerKey('synthetic-at-generation-one');
    check(saved.status === 'credential-saved' && saved.generation === 1n, 'first key saved');
    check(await vault.getKey() === 'synthetic-at-generation-one', 'authorized local use');
    check(JSON.stringify(await vault.inspect()) === JSON.stringify({status: 'saved-unverified', canSave: false}), 'saved status without secret');
    const aborted = new AbortController(); aborted.abort();
    check((await vault.inspect({signal: aborted.signal})).status === 'unavailable', 'cancelled inspection');
    check(await refused(() => vault.saveOwnerKey('unversioned-replacement')), 'same generation cannot replace key');
    const encrypted = await store.read('along-at-secret:' + binding.owner, binding.group + ':' + binding.credential);
    check(!Object.values(encrypted.value).includes('synthetic-at-generation-one'), 'no plaintext field');
    check(await refused(() => crypto.subtle.exportKey('raw', encrypted.value.wrappingKey)), 'wrapping key export refuses');
    const damaged = vaultModule.openLocalATVault({wasm, ...binding, store: {...store, read: async (scope, key) => {
      const record = await store.read(scope, key);
      if (scope.startsWith('along-at-secret:')) record.value.ciphertext[0] ^= 1;
      return record;
    }}});
    check(await refused(() => damaged.getKey()), 'ciphertext tampering refused');
    check((await damaged.inspect()).status === 'unavailable', 'damaged ciphertext never advertised as saved');
    const identity = await (await import('./local-persona.mjs')).loadLocalPersona({wasm, store, expectedGroup: group});
    const {credentialPolicyBytes} = await import('./policy.mjs');
    window.policies = (await import('./policy-store.mjs')).openCredentialPolicyStore({store, ...binding});
    window.changePolicy = async (revision, generation, devices) => {
      const bytes = credentialPolicyBytes({...binding, revision, generation, devices});
      return policies.update(bytes, await identity.sign(bytes));
    };
    await changePolicy(2n, 2n, [binding.owner]);
    check(await refused(() => vault.getKey()), 'old key unavailable after generation advances');
    check(JSON.stringify(await vault.inspect()) === JSON.stringify({status: 'replacement-needed', canSave: true}), 'replacement status');
    check((await vault.saveOwnerKey('synthetic-at-generation-two')).generation === 2n, 'replacement generation saved');
    check(await vault.getKey() === 'synthetic-at-generation-two', 'replacement usable');
    return binding;
  });
  const reopened = await context.newPage(); await reopened.goto(url);
  assert.equal(await reopened.evaluate(async binding => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const store = await (await import('./storage.mjs')).openBrowserStorage('local-at-vault');
    try { return await (await import('./local-vault.mjs')).openLocalATVault({wasm, store, ...binding}).getKey() === 'synthetic-at-generation-two'; }
    finally { store.close(); }
  }, binding), true);
  await reopened.close();
  await page.evaluate(async () => {
    const {createVaultATClient} = await import('./live-client.mjs');
    let entered, release, calls = 0;
    const started = new Promise(resolve => { entered = resolve; });
    const wait = new Promise(resolve => { release = resolve; });
    const client = createVaultATClient({vault, now: () => 1001, fetcher: async (url, request) => {
      calls++;
      if (url !== 'https://api.at.govt.nz/realtime/legacy/tripupdates'
          || request.headers['Ocp-Apim-Subscription-Key'] !== 'synthetic-at-generation-two') throw new Error('Unexpected request');
      entered(); await wait;
      return {ok: true, json: async () => ({header: {timestamp: 1000}, entity: []})};
    }});
    try {
      const pending = client.read('predictions', {requested: true});
      await started; await changePolicy(3n, 2n, []); release();
      if ((await pending).available) throw new Error('Removed device received feed');
      if ((await client.read('predictions', {requested: true})).available || calls !== 1) throw new Error('Removed device requested feed');
      await changePolicy(4n, 2n, [binding.owner]);
      if (!(await client.read('predictions', {requested: true})).available || calls !== 2) throw new Error('Explicit restored grant could not request');
    } finally { client.close(); }
  });
  await page.evaluate(async () => {
    const original = crypto.subtle.decrypt.bind(crypto.subtle);
    let entered, release; const started = new Promise(resolve => { entered = resolve; });
    const wait = new Promise(resolve => { release = resolve; });
    crypto.subtle.decrypt = async (...args) => { const result = await original(...args); entered(); await wait; return result; };
    try {
      const pending = vault.getKey().then(() => true, () => false);
      await started; await changePolicy(5n, 2n, []); release();
      if (await pending) throw new Error('Removed grant returned a pending plaintext');
    } finally { crypto.subtle.decrypt = original; }
    if (await vault.getKey().then(() => true, () => false)) throw new Error('Removed grant still reads');
    if ((await vault.inspect()).status !== 'unavailable') throw new Error('Removed grant advertised availability');
    store.close();
  });
  console.log('PASS: synthetic AT key encrypted under nonextractable browser AES custody; own-device policy gates save/use; no same-generation replacement, tampered ciphertext, stale generation or removed grant; fresh-document restore and removal during decryption. Software custody only; no real provider request or peer delivery.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
