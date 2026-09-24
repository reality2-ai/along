// Synthetic ordinary-member comparison, real isolated contexts and data channel.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
if (!process.env.R2_WASM_DIR) throw new Error('Set R2_WASM_DIR');
const sources = new Map(await Promise.all(['enrollment-link', 'enrollment-exchange', 'enrollment-protection', 'peer-link', 'invitation'].map(async name => ['/' + name + '.mjs', await readFile(new URL('./' + name + '.mjs', import.meta.url))])));
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
      window.module = await import('./enrollment-link.mjs');
      window.role = index === 0 ? 'candidate' : 'provisioner';
      window.create = variant => {
        const invitation = {group: new Uint8Array(32).fill(1), issuer: new Uint8Array(32).fill(2),
          code: new Uint8Array(16).fill(variant === 'wrong-invitation' ? 4 : 3), validity: 42n,
          role: variant === 'key-holder' ? 'key-holder' : 'member'};
        window.enrollment = module.createEnrollmentLink({wasm, invitation, role});
      };
    }, index);
  }));
  await new Promise(resolve => server.close(resolve));
  const connect = async () => {
    const offer = await pages[0].evaluate(() => enrollment.offer());
    const answer = await pages[1].evaluate(value => enrollment.accept(value), offer);
    await pages[0].evaluate(value => enrollment.accept(value), answer);
  };
  await Promise.all(pages.map(page => page.evaluate(() => create('normal'))));
  await connect();
  const comparisons = await Promise.all(pages.map(page => page.evaluate(async () => [...await enrollment.comparison()])));
  assert.equal(comparisons[0].length, 4); assert.deepEqual(comparisons[0], comparisons[1]);
  assert.deepEqual(await Promise.all(pages.map(page => page.evaluate(() => enrollment.state()))), ['comparison-ready', 'comparison-ready']);
  await pages[0].evaluate(() => enrollment.close());
  await pages[1].waitForFunction(() => enrollment.state() === 'closed');
  assert.equal(await pages[1].evaluate(() => enrollment.comparison().then(() => true, () => false)), false);
  await Promise.all(pages.map((page, index) => page.evaluate(variant => create(variant), index === 0 ? 'normal' : 'wrong-invitation')));
  await connect();
  await Promise.all(pages.map(page => page.waitForFunction(() => enrollment.state() === 'closed')));
  assert.deepEqual(await Promise.all(pages.map(page => page.evaluate(() => enrollment.comparison().then(() => true, () => false)))), [false, false]);
  assert.equal(await pages[0].evaluate(() => { try { create('key-holder'); return false; } catch { return true; } }), true);
  console.log('PASS: with the asset server stopped, isolated contexts exchange committed X25519 contributions over the actual channel and produce equal connection-bound comparison strings; substituted invitations close both endpoints, closure invalidates comparison, and key-holder invitations refuse this ordinary-member flow.');
} finally { await browser?.close(); if (server.listening) await new Promise(resolve => server.close(resolve)); }
