// Actual browser-software issuer and core enrollment; harness supplies initial trust and signaling.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
if (!process.env.R2_BROWSER_DIR) throw new Error('Set R2_BROWSER_DIR to the experimental Reality2 browser module directory');
if (!process.env.R2_WASM_DIR) throw new Error('Set R2_WASM_DIR');
const sources = new Map(await Promise.all(['peer-session', 'challenge', 'session-statement', 'membership', 'certificate', 'enrollment-session', 'storage', 'invitation-journal', 'enrollment-link', 'enrollment-exchange', 'enrollment-protection', 'peer-link', 'invitation'].map(async name => ['/' + name + '.mjs', await readFile(join(process.env.R2_BROWSER_DIR, name + '.mjs'))])));
for (const name of ['enrollment-profile.mjs', 'enrollment-payloads.mjs', 'core-candidate-session.mjs', 'software-traffic.mjs', 'initial-persona.mjs', 'software-persona.mjs', 'stored-claim.mjs', 'installation-receipt.mjs', 'local-persona.mjs', 'local-persona-session.mjs', 'receipt-recovery.mjs']) sources.set('/' + name, await readFile(new URL('./' + name, import.meta.url)));
if (process.env.RECOVERY_MODULE) sources.set('/receipt-recovery.mjs', await readFile(process.env.RECOVERY_MODULE));
for (const name of ['hive_wasm.js', 'hive_wasm_bg.wasm']) sources.set('/' + name, await readFile(join(process.env.R2_WASM_DIR, name)));
const server = createServer((req, res) => {
  if (sources.has(req.url)) { res.writeHead(200, {'Content-Type': req.url.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'}); res.end(sources.get(req.url)); }
  else { res.writeHead(200, {'Content-Type': 'text/html'}); res.end('<!doctype html><title>Core session test</title>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map(c => c.newPage()));
  const url = `http://127.0.0.1:${server.address().port}`;
  await Promise.all(pages.map(async (page, index) => {
    await page.goto(url);
    await page.evaluate(async index => {
      window.wasm = await import('./hive_wasm.js'); await wasm.default();
      window.store = await (await import('./storage.mjs')).openBrowserStorage('software-enrollment');
      window.restore = await import('./local-persona.mjs');
      if (index === 0) {
        const initial = await (await import('./initial-persona.mjs')).initializeLocalPersona({wasm, store}); initial.close();
        window.nonce = crypto.getRandomValues(new Uint8Array(16));
      } else {
        window.software = await import('./software-persona.mjs');
        const result = await software.initializeSoftwarePersona({wasm, store});
        window.group = Uint8Array.from(result.group.match(/../g), b => parseInt(b, 16));
        store.close(); window.store = await (await import('./storage.mjs')).openBrowserStorage('software-enrollment');
        window.issuer = await software.loadSoftwareIssuer({wasm, store, expectedGroup: group});
      }
    }, index);
  }));
  const nonce = await pages[0].evaluate(() => [...window.nonce]);
  const invitation = await pages[1].evaluate(async nonce => {
    const persona = await restore.loadLocalPersona({wasm, store, expectedGroup: group});
    const record = (await store.read('candidate-persona', 'active')).value.record;
    window.invitation = {group, issuer: record.subject, code: crypto.getRandomValues(new Uint8Array(16)), validity: 8n, role: 'member'};
    const statement = wasm.tg_invitation_statement(group, record.subject, 1, invitation.code, 8n);
    const proof = await persona.sign(wasm.tg_nonce_signing_bytes(statement, new Uint8Array(nonce)));
    window.session = await (await import('./enrollment-session.mjs')).createEnrollmentSession({wasm, invitation, role: 'provisioner', store});
    window.payloads = (await import('./enrollment-payloads.mjs')).enrollmentPayloads({wasm, invitation, epoch: 0n, role: 'provisioner', session});
    return {group: [...group], issuer: [...record.subject], code: [...invitation.code], certificate: [...record.certificate], proof: [...proof]};
  }, nonce);
  await pages[0].evaluate(async input => {
    // A reviewed QR/invitation must establish this group in the real UI. Here
    // the harness supplies that trust decision and the session descriptions.
    window.invitation = {group: new Uint8Array(input.group), issuer: new Uint8Array(input.issuer), code: new Uint8Array(input.code), validity: 8n, role: 'member'};
    const membership = wasm.BrowserMembership.establish(invitation.group, 0n, 0n);
    const statement = wasm.tg_invitation_statement(invitation.group, invitation.issuer, 1, invitation.code, 8n);
    const authorized = membership.authorise_invitation(statement, new Uint8Array(input.certificate), nonce, new Uint8Array(input.proof));
    membership.free(); if (!authorized) throw new Error('Actual invitation proof refused');
    window.session = await (await import('./core-candidate-session.mjs')).createCoreCandidateSession({wasm, store, invitation, authorized,
      softwareCustody: true, platform: {candidateDevelopment: false, provisionerDevelopment: false, provisionerHoldsCustody: true, epoch: 0n}});
  }, invitation);
  const offer = await pages[0].evaluate(() => session.offer());
  const answer = await pages[1].evaluate(offer => session.accept(offer), offer);
  await pages[0].evaluate(answer => session.accept(answer), answer);
  const comparisons = await Promise.all(pages.map(page => page.evaluate(async () => [...await session.comparison()])));
  assert.deepEqual(comparisons[0], comparisons[1]);
  await Promise.all(pages.map(page => page.evaluate(() => session.decide(true))));
  await pages[0].evaluate(() => session.sendClaim());
  const expectedKeys = await pages[1].evaluate(async () => {
    const subject = await payloads.claim();
    const material = await issuer.enrollmentMaterial(subject);
    const digests = await Promise.all([material.payloadKey, material.integrityKey].map(async key => [...new Uint8Array(await crypto.subtle.digest('SHA-256', key))]));
    try { await payloads.sendBundle(material); }
    finally { material.destroy(); }
    if (material.payloadKey.some(Boolean) || material.integrityKey.some(Boolean)) throw new Error('Temporary bundle was not cleared');
    return digests;
  });
  if (process.env.ABORT_TRAFFIC === '1') {
    assert.equal(await pages[0].evaluate(async () => {
      const original = IDBObjectStore.prototype.put; let triggered = false;
      IDBObjectStore.prototype.put = function(...args) {
        const result = original.apply(this, args);
        if (args[1]?.[0] === 'along-browser-traffic') { triggered = true; this.transaction.abort(); }
        return result;
      };
      try {
        if (await session.installLocal().then(() => true, () => false)) return false;
      } finally { IDBObjectStore.prototype.put = original; }
      const groupId = Array.from(invitation.group, b => b.toString(16).padStart(2, '0')).join('');
      return triggered && (await store.read('candidate-persona', 'active')).value.origin === 'initial'
        && await store.read('along-browser-traffic', groupId) === null && await store.read('membership', groupId) === null;
    }), true);
    console.log('PASS: interrupted traffic-key write rolls back recipient membership and persona with no orphan traffic record.');
  } else {
  const receipt = await pages[0].evaluate(() => session.installLocal());
  assert.equal(receipt.status, 'installed-local');
  await pages[0].evaluate(async () => { await session.dispose(); store.close(); });
  await pages[1].evaluate(async () => { issuer.close(); await session.cancel(); store.close(); });
  await pages[0].close();
  const reopened = await contexts[0].newPage(); await reopened.goto(url);
  assert.equal(await reopened.evaluate(async ({group, expectedKeys}) => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const store = await (await import('./storage.mjs')).openBrowserStorage('software-enrollment');
    try {
      const restored = await (await import('./local-persona.mjs')).loadLocalPersona({wasm, store, expectedGroup: new Uint8Array(group)});
      const module = await import('./software-traffic.mjs');
      const material = await module.loadSoftwareTraffic({wasm, store, expectedGroup: new Uint8Array(group)});
      const digests = await Promise.all([material.payloadKey, material.integrityKey].map(async key => [...new Uint8Array(await crypto.subtle.digest('SHA-256', key))]));
      if (JSON.stringify(digests) !== JSON.stringify(expectedKeys)) throw new Error('Restored group material differs');
      material.destroy();
      const denied = fn => fn().then(() => false, () => true);
      const corrupt = {...store, read: async (...args) => {
        const saved = await store.read(...args);
        if (args[0] === 'along-browser-traffic') saved.value.ciphertext[0] ^= 1;
        return saved;
      }};
      if (!await denied(() => module.loadSoftwareTraffic({wasm, store: corrupt, expectedGroup: new Uint8Array(group)}))) throw new Error('Tampered material accepted');
      const stale = {...store, read: async (...args) => {
        const saved = await store.read(...args);
        if (args[0] === 'along-browser-traffic') saved.value.epoch += 1n;
        return saved;
      }};
      if (!await denied(() => module.loadSoftwareTraffic({wasm, store: stale, expectedGroup: new Uint8Array(group)}))) throw new Error('Wrong epoch accepted');
      const aborted = new AbortController(); aborted.abort();
      if (!await denied(() => module.loadSoftwareTraffic({wasm, store, expectedGroup: new Uint8Array(group), signal: aborted.signal}))) throw new Error('Cancelled traffic read accepted');
      return restored.origin === 'enrolled' && restored.claim === 'owner' && (await restored.sign(new Uint8Array(32))).length === 64;
    } finally { store.close(); }
  }, {group: invitation.group, expectedKeys}), true);
  console.log('PASS: actual restored software issuer derives enrollment material, signs the candidate certificate, and completes core browser installation over WebRTC; fresh-document member restore/sign succeeds. Harness supplies trust review, comparison decision and signaling; encrypted traffic-key restore verified; no hardware custody or physical-device claim.');
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
