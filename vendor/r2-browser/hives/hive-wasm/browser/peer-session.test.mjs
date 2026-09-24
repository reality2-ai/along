// Real WebRTC + stored browser identities + compiled L5 verifier. Synthetic only.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
if (!process.env.R2_WASM_DIR) throw new Error('Set R2_WASM_DIR');
const modules = ['storage', 'identity', 'certificate', 'membership', 'challenge', 'session-statement', 'peer-link', 'peer-session'];
const sources = new Map(await Promise.all(modules.map(async name => ['/' + name + '.mjs', await readFile(new URL('./' + name + '.mjs', import.meta.url))])));
for (const name of ['hive_wasm.js', 'hive_wasm_bg.wasm']) sources.set('/' + name, await readFile(join(process.env.R2_WASM_DIR, name)));
const server = createServer((req, res) => {
  if (sources.has(req.url)) { res.writeHead(200, {'Content-Type': req.url.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'}); res.end(sources.get(req.url)); }
  else { res.writeHead(200, {'Content-Type': 'text/html'}); res.end('<!doctype html><title>Synthetic peer session test</title>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map(c => c.newPage()));
  const subjects = await Promise.all(pages.map(async page => {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    return page.evaluate(async () => {
      window.wasm = await import('./hive_wasm.js'); await wasm.default();
      window.sessionModule = await import('./peer-session.mjs');
      window.frames = []; window.received = [];
      const originalSend = RTCDataChannel.prototype.send;
      RTCDataChannel.prototype.send = function(text) { window.activeChannel = this; frames.push(JSON.parse(text)); return originalSend.call(this, text); };
      window.inject = frame => originalSend.call(activeChannel, JSON.stringify(frame));
      window.linkModule = await import('./peer-link.mjs');
      window.membershipModule = await import('./membership.mjs');
      window.codec = (await import('./certificate.mjs')).certificateCodec(wasm);
      window.store = await (await import('./storage.mjs')).openBrowserStorage('synthetic-session');
      window.identity = await (await import('./identity.mjs')).provisionDeviceIdentity(store);
      window.subject = Uint8Array.from(identity.publicId.match(/../g), b => parseInt(b, 16));
      return [...subject];
    });
  }));
  // Explicit test-harness trust bootstrap, not an implementation of enrollment.
  const enrollment = await pages[0].evaluate(async subjects => {
    window.authority = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
    const group = new Uint8Array(await crypto.subtle.exportKey('raw', authority.publicKey));
    const certificates = [];
    for (const bytes of subjects) {
      const subject = new Uint8Array(bytes);
      const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', authority.privateKey, codec.signingBytes(subject, group, 1n)));
      certificates.push([...codec.encode(subject, group, 1n, signature)]);
    }
    return {group: [...group], certificates};
  }, subjects);
  await Promise.all(pages.map((page, index) => page.evaluate(async ({enrollment, subjects, index}) => {
    window.group = new Uint8Array(enrollment.group);
    window.certificate = new Uint8Array(enrollment.certificates[index]);
    window.peer = new Uint8Array(subjects[1 - index]);
    window.membership = await membershipModule.establishMembership(store, wasm, {group, subject, current: 1n, depth: 0n, certificate});
    window.createSession = variant => {
      frames = []; received = [];
      const expectedPeer = peer.slice(), expectedGroup = group.slice();
      if (variant === 'wrong-peer') expectedPeer[0] ^= 1;
      if (variant === 'wrong-group') expectedGroup[0] ^= 1;
      window.session = sessionModule.createPeerSession({role: index === 0 ? 'offer' : 'answer', group: expectedGroup,
        epoch: variant === 'wrong-epoch' ? 2n : 1n, local: subject, peer: expectedPeer, identity, certificate, membership, wasm, onMessage: async (value, signal) => { if (signal.aborted) throw new Error('Message cancelled'); received.push([...value]); }});
    };
  }, {enrollment, subjects, index})));
  await new Promise(resolve => server.close(resolve));
  const connect = async () => {
    const offer = await pages[0].evaluate(() => session.offer());
    const answer = await pages[1].evaluate(value => session.accept(value), offer);
    await pages[0].evaluate(value => session.accept(value), answer);
  };
  assert.equal(await pages[0].evaluate(() => { try { createSession('wrong-group'); return false; } catch { return true; } }), true);
  for (const variant of ['wrong-peer', 'wrong-epoch']) {
    await Promise.all(pages.map((page, index) => page.evaluate(variant => createSession(variant), index === 0 ? variant : 'normal')));
    await connect();
    const accepted = await Promise.all(pages.map(page => page.evaluate(() => session.authenticated().then(() => true, () => false))));
    assert.deepEqual(accepted, [false, false]);
    assert.deepEqual(await Promise.all(pages.map(page => page.evaluate(() => session.state()))), ['closed', 'closed']);
  }
  await Promise.all(pages.map(page => page.evaluate(() => createSession('normal'))));
  await connect();
  await Promise.all(pages.map(page => page.evaluate(() => session.authenticated())));
  assert.deepEqual(await Promise.all(pages.map(page => page.evaluate(() => session.state()))), ['authenticated', 'authenticated']);
  await pages[0].evaluate(async () => {
    const value = new Uint8Array([1, 2]); const first = session.send(value); value.fill(9);
    await Promise.all([first, session.send(new Uint8Array([3]))]);
  });
  await pages[1].waitForFunction(() => received.length === 2);
  assert.deepEqual(await pages[1].evaluate(() => received), [[1, 2], [3]]);
  await pages[0].evaluate(() => inject(frames.find(frame => frame.type === 'application')));
  await Promise.all(pages.map(page => page.waitForFunction(() => session.state() === 'closed')));
  assert.deepEqual(await pages[1].evaluate(() => received), [[1, 2], [3]]);
  await Promise.all(pages.map(page => page.evaluate(() => createSession('normal'))));
  assert.equal(await pages[0].evaluate(() => session.send(new Uint8Array([1])).then(() => true, () => false)), false);
  await connect(); await Promise.all(pages.map(page => page.evaluate(() => session.authenticated())));
  await pages[0].evaluate(async () => {
    const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', authority.privateKey, wasm.tg_revocation_signing_bytes(peer, 1n, 1n, 0)));
    await membership.applyRevocation({subject: peer, epoch: 1n, sequence: 1n, reason: 0, signature});
  });
  await Promise.all(pages.map(page => page.waitForFunction(() => session.state() === 'closed')));
  assert.deepEqual(await Promise.all(pages.map(page => page.evaluate(() => session.authenticated().then(() => true, () => false)))), [false, false]);
  // Reconnection cannot turn held revocation into a fresh authorization.
  await Promise.all(pages.map(page => page.evaluate(() => createSession('normal'))));
  await connect();
  assert.deepEqual(await Promise.all(pages.map(page => page.evaluate(() => session.authenticated().then(() => true, () => false)))), [false, false]);
  // An unauthenticated peer cannot announce its way into an authenticated state.
  await pages[0].evaluate(() => createSession('normal'));
  await pages[1].evaluate(() => {
    window.session = linkModule.createPeerLink({role: 'answer', onMessage: () => {}});
  });
  await connect();
  await pages[1].evaluate(async () => { await session.opened(); session.send(JSON.stringify({type: 'ready'})); });
  assert.equal(await pages[0].evaluate(() => session.authenticated().then(() => true, () => false)), false);
  assert.equal(await pages[0].evaluate(() => session.state()), 'closed');
  console.log('PASS: authenticated messages preserve concurrent order and input snapshots; replay closes without redelivery; early sends refuse.');
  console.log('PASS: a premature ready frame cannot authenticate a peer, and querying authentication after revocation refuses.');
  console.log('PASS: with the asset server stopped, two isolated contexts mutually authenticate stored identities through WebRTC and actual L5 proofs; wrong expected peer/group/epoch refuse, learned revocation closes both sessions, and reconnect cannot restore the revoked peer.');
} finally { await browser?.close(); if (server.listening) await new Promise(resolve => server.close(resolve)); }
