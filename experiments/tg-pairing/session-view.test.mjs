// Synthetic invitations, durable one-shot confirmation, actual browser peers.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
if (!process.env.R2_BROWSER_DIR) throw new Error('Set R2_BROWSER_DIR to the Reality2 browser module directory');
if (!process.env.R2_WASM_DIR) throw new Error('Set R2_WASM_DIR');
const sources = new Map(await Promise.all(['enrollment-session', 'enrollment-link', 'enrollment-exchange', 'enrollment-protection', 'peer-link', 'invitation', 'invitation-journal', 'storage'].map(async name => ['/' + name + '.mjs', await readFile(join(process.env.R2_BROWSER_DIR, name + '.mjs'))])));
for (const name of ['session-view.mjs', 'comparison.mjs']) sources.set('/' + name, await readFile(new URL('./' + name, import.meta.url)));
for (const name of ['hive_wasm.js', 'hive_wasm_bg.wasm']) sources.set('/' + name, await readFile(join(process.env.R2_WASM_DIR, name)));
const server = createServer((req, res) => {
  if (sources.has(req.url)) { res.writeHead(200, {'Content-Type': req.url.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'}); res.end(sources.get(req.url)); }
  else { res.writeHead(200, {'Content-Type': 'text/html'}); res.end('<!doctype html><html lang="en"><head><title>Enrollment comparison test</title></head><body><main><div id="comparison"></div></main></body></html>'); }
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
      window.ui = await import('./session-view.mjs');
      window.store = await (await import('./storage.mjs')).openBrowserStorage('confirmation-test');
      window.role = index === 0 ? 'candidate' : 'provisioner';
      window.create = async variant => {
        const invitation = {group: new Uint8Array(32).fill(1), issuer: new Uint8Array(32).fill(2),
          code: new Uint8Array(16).fill(variant), validity: 42n,
          role: 'member'};
        window.enrollment = await module.createEnrollmentSession({wasm, invitation, role, store});
        window.screen = ui.showEnrollmentComparison(document.querySelector('#comparison'), {session: enrollment, focus: true});
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
  const match = page => page.getByRole('button', {name: 'Both devices are here and the codes match'});
  await setup(1);
  await Promise.all(pages.map(page => page.evaluate(() => screen.ready)));
  assert.equal(await pages[0].evaluate(() => document.activeElement.tagName), 'H2');
  assert.equal(await pages[0].locator('.pairing-code').textContent(), await pages[1].locator('.pairing-code').textContent());
  await match(pages[0]).click();
  assert.equal(await pages[0].evaluate(() => enrollment.state()), 'waiting-for-peer-confirmation');
  await match(pages[1]).click();
  await Promise.all(pages.map(page => page.getByRole('status').filter({hasText: 'Enrollment is not yet complete.'}).waitFor()));
  await pages[0].evaluate(() => screen.dispose());
  await pages[1].getByRole('status').filter({hasText: 'comparison has ended'}).waitFor();
  assert.equal(await pages[1].locator('button:enabled').count(), 0);
  await pages[1].evaluate(() => screen.dispose());

  await setup(2);
  await pages[0].evaluate(() => screen.ready);
  await pages[0].keyboard.press('Escape');
  await Promise.all(pages.map(page => page.waitForFunction(() => enrollment.signal.aborted)));
  await Promise.all(pages.map(page => page.evaluate(() => screen.dispose())));
  assert.deepEqual(await Promise.all(pages.map(page => page.evaluate(() => create(2).then(() => true, () => false)))), [false, false]);

  await setup(3);
  await match(pages[0]).click();
  // Mounting another flow must cancel the old session and its pending callback.
  await pages[0].evaluate(async () => {
    window.oldSession = enrollment;
    await create(4);
    await oldSession.cancel();
  });
  await pages[1].waitForFunction(() => enrollment.signal.aborted);
  assert.equal(await pages[0].getByRole('status').textContent(), 'Connecting to your other device…');
  assert.equal(await pages[0].evaluate(() => oldSession.confirmed().then(() => true, () => false)), false);
  await Promise.all(pages.map(page => page.evaluate(() => screen.dispose())));
  console.log('PASS: real connection-derived codes reach both screens; actual button/keyboard input confirms or declines, remote closure disables the UI, and replacing a pending view invalidates the old session without overwriting the new screen. Enrollment remains incomplete.');
} finally { await browser?.close(); if (server.listening) await new Promise(resolve => server.close(resolve)); }
