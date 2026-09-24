// Protected enrollment carriage over actual channels; all payloads synthetic.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
if (!process.env.R2_WASM_DIR) throw new Error('Set R2_WASM_DIR');
const sources = new Map(await Promise.all(['enrollment-session', 'storage', 'invitation-journal', 'enrollment-link', 'enrollment-exchange', 'enrollment-protection', 'peer-link', 'invitation'].map(async name => ['/' + name + '.mjs', await readFile(new URL('./' + name + '.mjs', import.meta.url))])));
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
        const invitation = {group: new Uint8Array(32).fill(1), issuer: new Uint8Array(32).fill(2),
          code: new Uint8Array(16).fill(++window.code), validity: 42n,
          role: variant === 'key-holder' ? 'key-holder' : 'member'};
        window.enrollment = await module.createEnrollmentSession({wasm, invitation, role, store});
      };
    }, index);
  }));
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
  await setup();
  await pages[0].evaluate(() => enrollment.sendClaim(new Uint8Array([6])));
  await pages[1].evaluate(() => enrollment.claim());
  await pages[1].evaluate(() => enrollment.sendBundle(new Uint8Array([7])));
  await pages[0].evaluate(() => enrollment.bundle());
  assert.equal(await pages[0].evaluate(async () => {
    try { await enrollment.sendInstalled(new Uint8Array([8])); return true; } catch { return false; }
  }), false, 'no installed message before a local committed transaction');
  assert.equal(await pages[0].evaluate(() => frames.some(frame => frame.type === 'installed')), false);
  // This synthetic write tests the session boundary only. The real controller
  // must provide the validated persona/membership write set.
  await pages[0].evaluate(() => enrollment.consume([{scope: 'receipt-fixture', key: 'commit', expectedRevision: 0, value: {synthetic: true}}]));
  await pages[0].evaluate(() => enrollment.sendInstalled(new Uint8Array([8])));
  assert.deepEqual(await pages[1].evaluate(async () => [...await enrollment.installed()]), [8]);
  await pages[1].evaluate(() => enrollment.sendAcknowledged(new Uint8Array([9])));
  assert.deepEqual(await pages[0].evaluate(async () => [...await enrollment.acknowledged()]), [9]);
  await pages[0].evaluate(() => inject(frames.find(frame => frame.type === 'installed')));
  await Promise.all(pages.map(page => page.waitForFunction(() => enrollment.state() === 'closed')));
  assert.equal(await pages[0].evaluate(() => enrollment.invitationState()), 'consumed');
  await pages[1].waitForFunction(() => enrollment.invitationState() === 'void');
  console.log('PASS: receipt/acknowledgment round trip requires a local commit and replay cannot undo it; confirmed actual peers exchange authenticated encrypted synthetic claim/bundle payloads; tampering, cross-session replay, same-session replay, early claim, out-of-order bundle and reads after closure refuse. This does not validate payload semantics or install membership.');
} finally { await browser?.close(); if (server.listening) await new Promise(resolve => server.close(resolve)); }
