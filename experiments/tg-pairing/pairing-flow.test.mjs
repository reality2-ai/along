// Actual browser-software issuer and core enrollment; harness supplies initial trust and signaling.
import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
if (!process.env.R2_BROWSER_DIR) throw new Error('Set R2_BROWSER_DIR to the experimental Reality2 browser module directory');
if (!process.env.R2_WASM_DIR) throw new Error('Set R2_WASM_DIR');
const sources = new Map(await Promise.all(['peer-session', 'challenge', 'session-statement', 'membership', 'certificate', 'enrollment-session', 'storage', 'invitation-journal', 'enrollment-link', 'enrollment-exchange', 'enrollment-protection', 'peer-link', 'invitation'].map(async name => ['/' + name + '.mjs', await readFile(join(process.env.R2_BROWSER_DIR, name + '.mjs'))])));
for (const name of ['enrollment-profile.mjs', 'enrollment-payloads.mjs', 'core-candidate-session.mjs', 'software-traffic.mjs', 'initial-persona.mjs', 'software-persona.mjs', 'software-invitation.mjs', 'invitation-proof.mjs', 'transfer-view.mjs', 'pairing-flow.mjs', 'comparison.mjs', 'comparison.css', 'receive-invitation-view.mjs', 'stored-claim.mjs', 'installation-receipt.mjs', 'local-persona.mjs', 'local-persona-session.mjs', 'receipt-recovery.mjs']) sources.set('/' + name, await readFile(new URL('./' + name, import.meta.url)));
if (process.env.RECOVERY_MODULE) sources.set('/receipt-recovery.mjs', await readFile(process.env.RECOVERY_MODULE));
for (const name of ['hive_wasm.js', 'hive_wasm_bg.wasm']) sources.set('/' + name, await readFile(join(process.env.R2_WASM_DIR, name)));
const server = createServer((req, res) => {
  if (sources.has(req.url)) { res.writeHead(200, {'Content-Type': req.url.endsWith('.wasm') ? 'application/wasm' : req.url.endsWith('.css') ? 'text/css' : 'text/javascript'}); res.end(sources.get(req.url)); }
  else { res.writeHead(200, {'Content-Type': 'text/html'}); res.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pairing flow</title><link rel="stylesheet" href="/comparison.css"></head><body><main><h1>Connect your devices</h1><div id="flow"></div></main></body></html>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const contexts = await Promise.all([browser.newContext({viewport: {width: 360, height: 780}}), browser.newContext({viewport: {width: 360, height: 780}})]);
  const pages = await Promise.all(contexts.map(c => c.newPage()));
  await Promise.all(pages.map(async (page, index) => {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(async index => {
      window.wasm = await import('./hive_wasm.js'); await wasm.default();
      window.store = await (await import('./storage.mjs')).openBrowserStorage('pairing-flow');
      const initial = await (await import('./software-persona.mjs')).initializeSoftwarePersona({wasm, store});
      window.group = Uint8Array.from(initial.group.match(/../g), b => parseInt(b, 16));
      window.flow = (await import('./pairing-flow.mjs')).showPairingFlow(document.querySelector('#flow'),
        {wasm, store, role: index ? 'provisioner' : 'candidate', expectedGroup: group, focus: true});
    }, index);
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
  if (process.env.CANCEL_FLOW === '1') {
    await candidate.getByRole('button', {name: 'Cancel — codes differ or I’m unsure', exact: true}).click();
    await Promise.all(pages.map(page => page.getByRole('heading', {name: 'Connection did not finish', exact: true}).waitFor()));
    assert.equal(await candidate.evaluate(async () => (await store.read('candidate-persona', 'active')).value.origin), 'initial');
    console.log('PASS: rejecting comparison ends both flows and preserves the candidate’s initial membership.');
  } else {
  await Promise.all(pages.map(async page => {
    await page.getByRole('button', {name: 'Both devices are here and the codes match', exact: true}).click();
  }));
  await candidate.getByRole('heading', {name: 'Device connected', exact: true}).waitFor();
  await owner.getByRole('heading', {name: 'Other device installed', exact: true}).waitFor();
  const target = await owner.evaluate(() => [...group]);
  assert.equal(await candidate.evaluate(async group => {
    const restored = await (await import('./local-persona.mjs')).loadLocalPersona({wasm, store, expectedGroup: new Uint8Array(group)});
    const traffic = await (await import('./software-traffic.mjs')).loadSoftwareTraffic({wasm, store, expectedGroup: new Uint8Array(group)});
    traffic.destroy(); return restored.origin === 'enrolled' && restored.peerAcknowledged;
  }, target), true);
  }
  await Promise.all(pages.map(page => page.evaluate(() => flow.dispose())));
  if (process.env.CANCEL_FLOW !== '1') console.log('PASS: both complete pairing flows exchange public messages through fields, compare codes, enroll over real WebRTC, acknowledge installation and restore encrypted traffic keys. Harness transfers text and confirms codes; no physical-device usability claim.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
