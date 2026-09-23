// Synthetic enrollment profile against the actual compiled certificate verifier.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
if (!process.env.R2_WASM_DIR) throw new Error('Set R2_WASM_DIR');
if (!process.env.R2_BROWSER_DIR) throw new Error('Set R2_BROWSER_DIR to the experimental Reality2 browser module directory');
const root = process.env.R2_BROWSER_DIR;
const sources = new Map(await Promise.all(['enrollment-profile.mjs', 'enrollment-payloads.mjs', 'installation-receipt.mjs'].map(async name => ['/' + name, await readFile(new URL('./' + name, import.meta.url))])));
for (const name of ['invitation.mjs', 'certificate.mjs']) sources.set('/' + name, await readFile(join(root, name)));
for (const name of ['hive_wasm.js', 'hive_wasm_bg.wasm']) sources.set('/' + name, await readFile(join(process.env.R2_WASM_DIR, name)));
const server = createServer((req, res) => {
  if (sources.has(req.url)) { res.setHeader('Content-Type', req.url.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'); res.end(sources.get(req.url)); }
  else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Enrollment profile</title>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(async () => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const {certificateCodec} = await import('./certificate.mjs');
    const {enrollmentPayloads} = await import('./enrollment-payloads.mjs');
    const {encodeClaim, decodeClaim, encodeBundle, decodeBundle} = await import('./enrollment-profile.mjs');
    const check = (v, reason) => { if (!v) throw new Error(reason); };
    const refuses = fn => { try { fn(); return false; } catch { return true; } };
    const authority = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
    const member = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
    const group = new Uint8Array(await crypto.subtle.exportKey('raw', authority.publicKey));
    const subject = new Uint8Array(await crypto.subtle.exportKey('raw', member.publicKey));
    const invitation = {group, issuer: new Uint8Array(32).fill(2), code: new Uint8Array(16).fill(3), validity: 9n, role: 'member'};
    const codec = certificateCodec(wasm), epoch = 7n;
    const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', authority.privateKey, codec.signingBytes(subject, group, epoch)));
    const certificate = codec.encode(subject, group, epoch, signature);
    const claim = encodeClaim(wasm, invitation, subject);
    check(decodeClaim(wasm, invitation, claim).every((b, i) => b === subject[i]), 'candidate identity round trip');
    const fields = {certificate, epoch, payloadKey: new Uint8Array(32).fill(4), integrityKey: new Uint8Array(32).fill(5)};
    const bytes = encodeBundle(wasm, invitation, claim, fields);
    const bundle = decodeBundle(wasm, invitation, claim, epoch, bytes);
    check(bundle.epoch === epoch && bundle.payloadKey.every(b => b === 4) && bundle.integrityKey.every(b => b === 5), 'valid bundle');
    bundle.destroy(); check(bundle.payloadKey.every(b => b === 0) && bundle.integrityKey.every(b => b === 0), 'explicit material clearing');
    for (const offset of [0, 8, 96, 137, 144, 145, 217, 280]) {
      const changed = bytes.slice(); changed[offset] ^= 1;
      check(refuses(() => decodeBundle(wasm, invitation, claim, epoch, changed)), 'bundle substitution at ' + offset);
    }
    check(refuses(() => decodeBundle(wasm, invitation, claim, epoch, bytes.slice(0, -1))), 'truncated bundle');
    check(refuses(() => decodeBundle(wasm, invitation, claim, epoch, new Uint8Array([...bytes, 0]))), 'trailing bundle fields');
    check(refuses(() => decodeBundle(wasm, invitation, claim, 8n, bytes)), 'unexpected epoch');
    check(refuses(() => decodeBundle(wasm, invitation, encodeClaim(wasm, invitation, new Uint8Array(32)), epoch, bytes)), 'another requested member');
    for (const field of ['group', 'issuer', 'code']) {
      const changed = structuredClone(invitation); changed[field][0] ^= 1;
      check(refuses(() => decodeClaim(wasm, changed, claim)), 'changed invitation ' + field);
    }
    check(refuses(() => encodeClaim(wasm, {...invitation, role: 'key-holder'}, subject)), 'key-holder not allowed');
    check(refuses(() => encodeBundle(wasm, invitation, claim, {...fields, epoch: 8n})), 'certificate epoch mismatch');
    const forged = certificate.slice(); forged[100] ^= 1;
    check(refuses(() => encodeBundle(wasm, invitation, claim, {...fields, certificate: forged})), 'forged signature');
    // Exact subarray offsets matter: do not accidentally read its backing buffer's prefix.
    const padded = new Uint8Array(400); padded.set(bytes, 11);
    decodeBundle(wasm, invitation, claim, epoch, padded.subarray(11, 356)).destroy();
    // Controlled session delays isolate cancellation races; the separate
    // carriage test exercises the actual runtime/channel and durable journal.
    const mock = () => {
      const life = new AbortController(); let resolve;
      const pending = new Promise(yes => { resolve = yes; });
      return {signal: life.signal, state: () => life.signal.aborted ? 'closed' : 'comparison-confirmed',
        sendClaim: async () => {}, bundle: () => pending,
        cancel: async () => life.abort(), deliver: resolve};
    };
    const session = mock();
    const mutableInvitation = structuredClone(invitation);
    const reader = enrollmentPayloads({wasm, invitation: mutableInvitation, role: 'candidate', epoch, session});
    mutableInvitation.code.fill(99);
    await reader.sendClaim(subject);
    const waiting = reader.bundle();
    await session.cancel(); const late = bytes.slice(); session.deliver(late);
    check(await waiting.then(() => false, () => true), 'late bundle must refuse');
    check(late.every(b => b === 0), 'late input material cleared');

    const second = mock();
    const other = enrollmentPayloads({wasm, invitation, role: 'candidate', epoch, session: second});
    await other.sendClaim(subject); second.deliver(bytes.slice());
    const held = await other.bundle();
    check(held.payloadKey.every(b => b === 4), 'controller accepts matching bundle');
    check(await other.bundle().then(() => false, () => true), 'duplicate bundle read refuses');
    check(second.signal.aborted && held.payloadKey.every(b => b === 0), 'duplicate closes and clears delivered material');

    const third = mock();
    const snapshot = structuredClone(invitation);
    const snapReader = enrollmentPayloads({wasm, invitation: snapshot, role: 'candidate', epoch, session: third});
    snapshot.group.fill(0); await snapReader.sendClaim(subject); third.deliver(bytes.slice());
    const snapBundle = await snapReader.bundle();
    check(snapBundle.payloadKey.every(b => b === 4), 'invitation is snapshotted');
    await third.cancel(); check(snapBundle.integrityKey.every(b => b === 0), 'abort clears delivered integrity material');
    return true;
  });
  assert.equal(result, true);
  console.log('PASS: profile binds the original invitation, candidate key and expected epoch; actual WASM verifies the group certificate; substitutions, forgery, truncation and extra fields refuse. Controlled delayed delivery, duplicate reads and cancellation clear volatile material; installation/custody remain separate.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
