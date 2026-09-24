// Synthetic invitations, durable one-shot confirmation, actual browser peers.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
if (!process.env.R2_WASM_DIR) throw new Error('Set R2_WASM_DIR');
const sources = new Map(await Promise.all(['enrollment-session', 'enrollment-link', 'enrollment-exchange', 'enrollment-protection', 'peer-link', 'invitation', 'invitation-journal', 'storage'].map(async name => ['/' + name + '.mjs', await readFile(new URL('./' + name + '.mjs', import.meta.url))])));
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
      window.store = await (await import('./storage.mjs')).openBrowserStorage('confirmation-test');
      window.role = index === 0 ? 'candidate' : 'provisioner';
      window.create = async variant => {
        const invitation = {group: new Uint8Array(32).fill(1), issuer: new Uint8Array(32).fill(2),
          code: new Uint8Array(16).fill(variant), validity: 42n,
          role: 'member'};
        const storage = window.failVoid ? {...store, compareAndSwapMany: async () => { throw new Error('Synthetic storage fault'); }} : store;
        window.enrollment = await module.createEnrollmentSession({wasm, invitation, role, store: storage});
      };
    }, index);
  }));
  await new Promise(resolve => server.close(resolve));
  const connect = async () => {
    const offer = await pages[0].evaluate(() => enrollment.offer());
    const answer = await pages[1].evaluate(value => enrollment.accept(value), offer);
    await pages[0].evaluate(value => enrollment.accept(value), answer);
  };
  const setup = async code => {
    await Promise.all(pages.map(page => page.evaluate(code => create(code), code)));
    await connect();
    const comparisons = await Promise.all(pages.map(page => page.evaluate(async () => [...await enrollment.comparison()])));
    assert.deepEqual(comparisons[0], comparisons[1]);
  };
  await setup(1);
  await pages[0].evaluate(() => { window.decision = enrollment.decide(true); void decision.catch(() => {}); });
  assert.equal(await pages[0].evaluate(() => enrollment.state()), 'waiting-for-peer-confirmation');
  await pages[1].evaluate(() => enrollment.decide(true));
  await pages[0].evaluate(() => decision);
  assert.deepEqual(await Promise.all(pages.map(page => page.evaluate(() => enrollment.state()))), ['comparison-confirmed', 'comparison-confirmed']);
  await pages[0].evaluate(() => enrollment.cancel());
  await pages[1].waitForFunction(() => enrollment.signal.aborted);
  assert.deepEqual(await Promise.all(pages.map(page => page.evaluate(() => enrollment.confirmed().then(() => true, () => false)))), [false, false]);
  await pages[1].evaluate(() => enrollment.cancel());
  assert.deepEqual(await Promise.all(pages.map(page => page.evaluate(() => enrollment.invitationState()))), ['void', 'void']);
  assert.deepEqual(await Promise.all(pages.map(page => page.evaluate(() => create(1).then(() => true, () => false)))), [false, false]);

  await setup(2);
  await pages[0].evaluate(() => enrollment.decide(false));
  await pages[1].waitForFunction(() => enrollment.signal.aborted);
  await pages[1].evaluate(() => enrollment.cancel());
  assert.deepEqual(await Promise.all(pages.map(page => page.evaluate(() => create(2).then(() => true, () => false)))), [false, false]);

  await setup(3);
  await pages[0].evaluate(() => {
    window.view = new AbortController();
    window.decision = enrollment.decide(true, view.signal); void decision.catch(() => {});
    view.abort();
  });
  assert.equal(await pages[0].evaluate(() => decision.then(() => true, () => false)), false);
  await pages[1].waitForFunction(() => enrollment.signal.aborted);
  await Promise.all(pages.map(page => page.evaluate(() => enrollment.cancel())));

  await setup(4);
  await pages[0].evaluate(() => { window.decision = enrollment.decide(true); void decision.catch(() => {}); });
  assert.equal(await pages[0].evaluate(() => enrollment.decide(true).then(() => true, () => false)), false);
  await pages[1].waitForFunction(() => enrollment.signal.aborted);
  await Promise.all(pages.map(page => page.evaluate(() => enrollment.cancel())));

  await setup(5);
  await pages[0].evaluate(() => { window.view = new AbortController(); window.decision = enrollment.decide(true, view.signal); void decision.catch(() => {}); });
  await pages[1].evaluate(() => enrollment.decide(true));
  await pages[0].evaluate(() => decision);
  // A resolved confirmation is not a durable authority: view loss closes it.
  await pages[0].evaluate(() => view.abort());
  await pages[1].waitForFunction(() => enrollment.signal.aborted);
  await Promise.all(pages.map(page => page.evaluate(() => enrollment.cancel())));
  assert.equal(await pages[0].evaluate(() => enrollment.confirmed().then(() => true, () => false)), false);
  await setup(6);
  await pages[0].evaluate(() => { window.decision = enrollment.decide(true); void decision.catch(() => {}); });
  await pages[1].evaluate(() => enrollment.decide(true));
  await pages[0].evaluate(() => decision);
  // Simulate a throttled timeout callback after the actual lifetime has elapsed.
  await pages[0].evaluate(() => {
    const later = performance.now() + 60001;
    Object.defineProperty(performance, 'now', {value: () => later, configurable: true});
  });
  assert.equal(await pages[0].evaluate(() => enrollment.confirmed().then(() => true, () => false)), false);
  await Promise.all(pages.map(page => page.evaluate(() => enrollment.cancel())));
  await pages[0].evaluate(() => { delete performance.now; window.failVoid = true; });
  await pages[0].evaluate(() => create(7));
  assert.equal(await pages[0].evaluate(() => enrollment.cancel().then(() => true, () => false)), false);
  assert.equal(await pages[0].evaluate(() => enrollment.invitationState()), 'unavailable');
  await pages[0].evaluate(() => { window.failVoid = false; });
  assert.equal(await pages[0].evaluate(() => create(7).then(() => true, () => false)), false);
  console.log('PASS: actual isolated browser peers require both decisions; decline, disconnect, duplicate decision, view abort and delayed timeout invalidate confirmation. Durable reservations prevent reuse even after a failed void write. No installation or credential authorization is claimed.');
} finally { await browser?.close(); if (server.listening) await new Promise(resolve => server.close(resolve)); }
