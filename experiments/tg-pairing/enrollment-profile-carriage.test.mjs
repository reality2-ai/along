// Protected enrollment carriage over actual channels; all payloads synthetic.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
if (!process.env.R2_BROWSER_DIR) throw new Error('Set R2_BROWSER_DIR to the experimental Reality2 browser module directory');
if (!process.env.R2_WASM_DIR) throw new Error('Set R2_WASM_DIR');
const sources = new Map(await Promise.all(['certificate', 'enrollment-session', 'storage', 'invitation-journal', 'enrollment-link', 'enrollment-exchange', 'enrollment-protection', 'peer-link', 'invitation'].map(async name => ['/' + name + '.mjs', await readFile(join(process.env.R2_BROWSER_DIR, name + '.mjs'))])));
for (const name of ['enrollment-profile.mjs', 'enrollment-payloads.mjs', 'installation-receipt.mjs', 'candidate-session.mjs']) sources.set('/' + name, await readFile(new URL('./' + name, import.meta.url)));
for (const name of ['hive_wasm.js', 'hive_wasm_bg.wasm']) sources.set('/' + name, await readFile(join(process.env.R2_WASM_DIR, name)));
const server = createServer((req, res) => {
  if (sources.has(req.url)) { res.writeHead(200, {'Content-Type': req.url.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'}); res.end(sources.get(req.url)); }
  else { res.writeHead(200, {'Content-Type': 'text/html'}); res.end('<!doctype html><title>Enrollment comparison test</title>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  await Promise.all(pages.map(async (page, index) => {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(async index => {
      window.wasm = await import('./hive_wasm.js'); await wasm.default();
      window.module = await import('./enrollment-session.mjs');
      window.profile = await import('./enrollment-profile.mjs');
      window.controller = await import('./enrollment-payloads.mjs');
      window.candidateModule = await import('./candidate-session.mjs');
      window.closedKeys = 0;
      const originalClose = wasm.BrowserCandidateKey.prototype.close;
      wasm.BrowserCandidateKey.prototype.close = function() { closedKeys++; return originalClose.call(this); };
      window.codec = (await import('./certificate.mjs')).certificateCodec(wasm);
      window.store = await (await import('./storage.mjs')).openBrowserStorage('carriage-test'); window.code = 2;
      window.role = index === 0 ? 'candidate' : 'provisioner';
      window.frames = []; window.corrupt = false;
      const originalSend = RTCDataChannel.prototype.send;
      RTCDataChannel.prototype.send = function(text) {
        window.activeChannel = this;
        const frame = JSON.parse(text);
        if (window.corrupt && frame.type === 'claim') frame.value[frame.value.length - 1] ^= 1;
        frames.push(structuredClone(frame)); originalSend.call(this, JSON.stringify(frame));
      };
      window.inject = frame => originalSend.call(activeChannel, JSON.stringify(frame));
      window.create = async variant => {
        window.invitation = {group: window.group, issuer: new Uint8Array(32).fill(2),
          code: new Uint8Array(16).fill(++window.code), validity: 42n,
          role: variant === 'key-holder' ? 'key-holder' : 'member'};
        window.enrollment = await module.createEnrollmentSession({wasm, invitation, role, store});
        window.payloads = controller.enrollmentPayloads({wasm, invitation, role, epoch: 7n, session: enrollment});
      };
    }, index);
  }));
  const group = await pages[1].evaluate(async () => {
    window.authority = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
    return [...new Uint8Array(await crypto.subtle.exportKey('raw', authority.publicKey))];
  });
  // Synthetic initial-trust bootstrap; the real invitation ceremony must replace it.
  await Promise.all(pages.map(page => page.evaluate(group => { window.group = new Uint8Array(group); }, group)));
  await new Promise(resolve => server.close(resolve));
  const connect = async () => {
    const offer = await pages[0].evaluate(() => enrollment.offer());
    const answer = await pages[1].evaluate(value => enrollment.accept(value), offer);
    await pages[0].evaluate(value => enrollment.accept(value), answer);
  };
  const setup = async (confirm = true) => {
    await Promise.all(pages.map(page => page.evaluate(() => { frames = []; corrupt = false; return create('normal'); })));
    await connect();
    await Promise.all(pages.map(page => page.evaluate(() => enrollment.comparison())));
    if (confirm) {
      await Promise.all(pages.map(page => page.evaluate(() => enrollment.decide(true))));
      await Promise.all(pages.map(page => page.evaluate(() => enrollment.confirmed())));
    }
  };
  const closed = () => Promise.all(pages.map(page => page.waitForFunction(() => enrollment.state() === 'closed' && enrollment.invitationState() === 'void')));
  await setup();
  await pages[0].evaluate(async () => {
    window.candidate = await candidateModule.createCandidateEnrollment({wasm, invitation, epoch: 7n, session: enrollment});
    await candidate.sendClaim();
  });
  await pages[1].evaluate(async () => {
    const subject = await payloads.claim(), epoch = 7n;
    const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', authority.privateKey, codec.signingBytes(subject, group, epoch)));
    const certificate = codec.encode(subject, group, epoch, signature);
    await payloads.sendBundle({certificate, epoch,
      payloadKey: new Uint8Array(32).fill(4), integrityKey: new Uint8Array(32).fill(5)});
  });
  assert.equal(await pages[0].evaluate(async () => {
    window.receivedBundle = await candidate.bundle();
    return receivedBundle.payloadKey.every(b => b === 4) && receivedBundle.integrityKey.every(b => b === 5);
  }), true);
  await pages[0].evaluate(() => enrollment.cancel()); await closed();
  assert.equal(await pages[0].evaluate(() => closedKeys), 1);
  await pages[0].evaluate(() => candidate.dispose());
  assert.equal(await pages[0].evaluate(() => closedKeys), 1);
  assert.equal(await pages[0].evaluate(() => receivedBundle.payloadKey.every(b => b === 0) && receivedBundle.integrityKey.every(b => b === 0)), true);

  // Cancellation while Web Crypto generation is pending must close the newly
  // returned key and must never emit a claim, even after its promise resolves.
  await setup();
  await pages[0].evaluate(() => {
    const original = wasm.BrowserCandidateKey.generate;
    window.generationReady = false;
    wasm.BrowserCandidateKey.generate = async () => {
      const generated = await original(); generationReady = true;
      await new Promise(resolve => { window.releaseGeneration = resolve; });
      return generated;
    };
    window.creation = candidateModule.createCandidateEnrollment({wasm, invitation, epoch: 7n, session: enrollment})
      .then(() => true, () => false).finally(() => { wasm.BrowserCandidateKey.generate = original; });
  });
  await pages[0].waitForFunction(() => generationReady);
  await pages[1].evaluate(() => enrollment.cancel()); await closed();
  await pages[0].evaluate(() => releaseGeneration());
  assert.equal(await pages[0].evaluate(() => creation), false);
  assert.equal(await pages[0].evaluate(() => closedKeys), 2);
  assert.equal(await pages[0].evaluate(() => frames.some(frame => frame.type === 'claim')), false);

  // Authenticated encryption alone accepts these bytes; the application profile
  // must reject them and durably cancel enrollment on both peers.
  await setup();
  await pages[0].evaluate(() => enrollment.sendClaim(new Uint8Array([1, 2, 3])));
  assert.equal(await pages[1].evaluate(() => payloads.claim().then(() => true, () => false)), false);
  await closed();

  await setup();
  await pages[0].evaluate(() => payloads.sendClaim(new Uint8Array(32).fill(6)));
  await pages[1].evaluate(async () => { await enrollment.claim(); await enrollment.sendBundle(new Uint8Array(345)); });
  assert.equal(await pages[0].evaluate(() => payloads.bundle().then(() => true, () => false)), false);
  await closed();
  await setup();
  await pages[0].evaluate(() => enrollment.sendClaim(new Uint8Array([1, 2, 3])));
  assert.deepEqual(await pages[1].evaluate(async () => [...await enrollment.claim()]), [1, 2, 3]);
  const oldClaim = await pages[0].evaluate(() => frames.find(frame => frame.type === 'claim'));
  assert.equal(oldClaim.value.length, 31);
  await pages[1].evaluate(() => enrollment.sendBundle(new Uint8Array([8, 9, 10, 11])));
  assert.deepEqual(await pages[0].evaluate(async () => [...await enrollment.bundle()]), [8, 9, 10, 11]);
  await pages[0].evaluate(() => enrollment.cancel()); await closed();
  assert.equal(await pages[0].evaluate(() => enrollment.bundle().then(() => true, () => false)), false);

  await setup();
  await pages[0].evaluate(frame => inject(frame), oldClaim);
  await closed();
  assert.equal(await pages[1].evaluate(() => enrollment.claim().then(() => true, () => false)), false);

  await setup();
  await pages[0].evaluate(() => { corrupt = true; return enrollment.sendClaim(new Uint8Array([5])); });
  await closed();
  assert.equal(await pages[1].evaluate(() => enrollment.claim().then(() => true, () => false)), false);

  await setup(false);
  assert.equal(await pages[0].evaluate(() => enrollment.sendClaim(new Uint8Array([5])).then(() => true, () => false)), false);
  await closed();

  await setup();
  assert.equal(await pages[1].evaluate(() => enrollment.sendBundle(new Uint8Array([5])).then(() => true, () => false)), false);
  await closed();

  await setup();
  await pages[0].evaluate(() => enrollment.sendClaim(new Uint8Array([5])));
  await pages[1].evaluate(() => enrollment.claim());
  await pages[0].evaluate(() => inject(frames.find(frame => frame.type === 'claim')));
  await closed();
  console.log('PASS: a candidate-generated key reaches a group-signed validated bundle through the encrypted peer session, using an explicitly synthetic initial trust bootstrap; confirmed actual peers exchange authenticated encrypted synthetic claim/bundle payloads; tampering, cross-session replay, same-session replay, early claim, out-of-order bundle and reads after closure refuse. The later transport counterexamples use opaque payloads; candidate keys close with the session, including after delayed generation; initial trust, durable custody and membership installation remain unproven.');
} finally { await browser?.close(); if (server.listening) await new Promise(resolve => server.close(resolve)); }
