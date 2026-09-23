// Actual generated journey app on a static subpath, with a real local software
// identity/vault and mocked provider. No production key or proxy is involved.
import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join, extname} from 'node:path';
const {chromium, expect} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const variants = ['INTERRUPT_GRANT', 'INTERRUPT_ACCEPTANCE', 'LOSE_KEY_CONFIRMATION', 'LOSE_KEY_DELIVERY', 'REPLACE_SHARED_KEY'].filter(name => process.env[name] === '1');
assert.ok(variants.length <= 1, 'Select one interruption scenario per run');
let pendingLostDelivery;
const mainSetup = process.env.MAIN_APP_SETUP === '1';
const replaceSharedKey = process.env.REPLACE_SHARED_KEY === '1';
assert.ok(!replaceSharedKey || mainSetup, 'Replacement scenario uses actual app Settings');
const preview = process.env.PREVIEW === '1';
const root = new URL(preview ? '../../releases/along-device-preview/' : '../../releases/along-experimental-app/', import.meta.url).pathname;
const manifest = JSON.parse(await readFile(join(root, 'build-info.json'), 'utf8'));
assert.equal(manifest.profile, preview ? 'along-device-preview-v1' : 'along-experimental-app-v1');
const deviceDatabase = manifest.namespaces?.devices ?? 'along-pairing-lab-v1';
assert.equal(Object.keys(manifest.files).some(name => /APIKey|\.test\./.test(name)), false);
const sources = new Map(await Promise.all(Object.entries(manifest.files).map(async ([name, hash]) => {
  const bytes = await readFile(join(root, name));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hash); return [name, bytes];
})));
const prefix = '/along-exp/';
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const name = path.startsWith(prefix) ? path.slice(prefix.length) + (path.endsWith('/') ? 'index.html' : '') : '';
  const body = sources.get(name);
  if (!body) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', ({'.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.css': 'text/css', '.gz': 'application/gzip', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml'})[extname(name)] || 'text/plain');
  res.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  for (const page of pages) await page.addInitScript(name => { window.testDeviceDatabase = name; }, deviceDatabase);
  const origin = `http://127.0.0.1:${server.address().port}${prefix}`;
  const providerRequests = [], errors = [];
  for (const page of pages) page.on('pageerror', error => errors.push(error.message));
  for (const context of contexts) await context.route('https://api.at.govt.nz/**', async route => {
    assert.equal(route.request().headers()['ocp-apim-subscription-key'], replaceSharedKey ? 'synthetic-two-app-replacement' : 'synthetic-two-app-key');
    providerRequests.push(new URL(route.request().url()).pathname);
    await route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({header: {timestamp: Math.floor(Date.now()/1000)}, entity: []})});
  });
  const restoreSetup = async page => {
    if (mainSetup) {
      const setup = page.getByRole('dialog', {name: 'Device and AT-key setup', exact: true});
      if (!await setup.isVisible()) {
        await page.locator('#settings-open').click();
        await page.getByRole('button', {name: 'Device and AT-key setup', exact: true}).click();
      }
      await page.getByRole('heading', {name: 'Your devices and AT key', exact: true}).waitFor();
    } else await page.getByRole('button', {name: 'Restore saved test device', exact: true}).click();
  };
  await Promise.all(pages.map(async (page, index) => {
    await page.goto(origin + (mainSetup ? 'public/' : 'experiments/'));
    if (mainSetup) {
      await page.locator('#settings-open').click();
      await page.getByRole('button', {name: 'Device and AT-key setup', exact: true}).click();
    }
    await page.getByRole('button', {name: mainSetup ? 'Set up my device' : 'Set up this test device', exact: true}).click();
    await page.getByRole('button', {name: 'Create my device group', exact: true}).click();
    await restoreSetup(page);
    if (mainSetup) await page.getByText('Connect or recover another device', {exact: true}).click();
    await page.getByRole('button', {name: index ? 'Invite my other device' : 'Join my other device', exact: true}).click();
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
  assert.equal(await candidate.locator('.pairing-code').textContent(), await owner.locator('.pairing-code').textContent());

  await Promise.all(pages.map(async page => {
    await page.getByRole('button', {name: 'Both devices are here and the codes match', exact: true}).click();
  }));
  await candidate.getByRole('heading', {name: 'Device connected', exact: true}).waitFor();
  await owner.getByRole('heading', {name: 'Other device installed', exact: true}).waitFor();

  await Promise.all(pages.map(page => page.reload()));
  await Promise.all(pages.map(restoreSetup));
  await owner.getByRole('button', {name: mainSetup ? 'Use my own AT key' : 'Test optional AT-key storage', exact: true}).click();
  await owner.getByRole('button', {name: 'Set up live information', exact: true}).click();
  await owner.getByLabel('Personal AT API key', {exact: true}).fill('synthetic-two-app-key');
  await owner.getByRole('button', {name: 'Save key on this device', exact: true}).click();
  await owner.getByRole('heading', {name: 'AT key saved on this device', exact: true}).waitFor();
  await owner.getByRole('button', {name: 'Back', exact: true}).click();
  await restoreSetup(owner);
  await owner.getByRole('button', {name: 'Share my AT key', exact: true}).click();
  await candidate.getByRole('button', {name: 'Receive a shared AT key', exact: true}).click();
  await owner.getByRole('heading', {name: 'Share your AT key', exact: true}).waitFor();
  await move(owner, candidate, 'AT-key sharing message', 'Review sharing device');
  await candidate.getByRole('button', {name: 'Back', exact: true}).click();
  await restoreSetup(candidate);
  await candidate.getByRole('button', {name: 'Receive a shared AT key', exact: true}).click();
  await move(owner, candidate, 'AT-key sharing message', 'Review sharing device');
  const noAcceptedOwner = () => candidate.evaluate(async () => {
    const store = await (await import('../experiments/tg-pairing/storage.mjs')).openBrowserStorage(window.testDeviceDatabase);
    try {
      const record = (await store.read('candidate-persona', 'active')).value.record;
      const group = Array.from(record.group, b => b.toString(16).padStart(2, '0')).join('');
      return await store.read('along-at-owners', group) === null;
    } finally { store.close(); }
  });
  assert.equal(await noAcceptedOwner(), true);
  await candidate.setViewportSize({width: 320, height: 640});
  await candidate.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  assert.equal(await candidate.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual((await new AxeBuilder({page: candidate}).analyze()).violations.map(v => v.id), []);
  await candidate.getByRole('button', {name: 'Connect to this sharing device', exact: true}).click();
  await candidate.getByRole('heading', {name: 'Connect for key sharing', exact: true}).waitFor();
  await move(candidate, owner, 'Sharing connection request', 'Connect for key sharing');
  await owner.getByRole('heading', {name: 'Send the sharing reply', exact: true}).waitFor();
  await move(owner, candidate, 'Sharing connection reply', 'Check sharing connection');
  await owner.getByRole('button', {name: 'Allow AT access', exact: true}).click();
  const acceptKey = candidate.getByRole('button', {name: 'Allow this device to receive the key', exact: true});
  await acceptKey.waitFor();
  if (process.env.INTERRUPT_GRANT === '1') {
    const snapshot = page => page.evaluate(async () => {
      const store = await (await import('../experiments/tg-pairing/storage.mjs')).openBrowserStorage(window.testDeviceDatabase);
      try {
        const record = (await store.read('candidate-persona', 'active')).value.record;
        const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
        const anchor = await store.read('along-at-owners', hex(record.group));
        const policy = anchor && await store.read('along-at-policy:' + anchor.value.owner, hex(record.group) + ':' + anchor.value.credential);
        return {member: hex(record.subject), anchorRevision: anchor?.revision, policyRevision: policy?.revision};
      } finally { store.close(); }
    });
    const before = await Promise.all(pages.map(snapshot));
    assert.equal(await noAcceptedOwner(), true);
    await Promise.all(pages.map(page => page.reload()));
    await Promise.all(pages.map(restoreSetup));
    await owner.getByRole('button', {name: 'Share my AT key', exact: true}).click();
    await candidate.getByRole('button', {name: 'Receive a shared AT key', exact: true}).click();
    await owner.getByRole('heading', {name: 'Share your AT key', exact: true}).waitFor();
    await move(owner, candidate, 'AT-key sharing message', 'Review sharing device');
    await candidate.getByRole('button', {name: 'Connect to this sharing device', exact: true}).click();
    await candidate.getByRole('heading', {name: 'Connect for key sharing', exact: true}).waitFor();
    await move(candidate, owner, 'Sharing connection request', 'Connect for key sharing');
    await owner.getByRole('heading', {name: 'Send the sharing reply', exact: true}).waitFor();
    await move(owner, candidate, 'Sharing connection reply', 'Check sharing connection');
    const resume = owner.getByRole('button', {name: 'Continue sharing my key', exact: true});
    await resume.waitFor();
    assert.equal(await owner.getByRole('button', {name: 'Remove AT access', exact: true}).count(), 0);
    await resume.evaluate(button => button.click());
    assert.equal(await candidate.getByRole('button', {name: 'Allow this device to receive the key', exact: true}).count(), 0);
    assert.deepEqual(await Promise.all(pages.map(snapshot)), before);
    await resume.focus(); await owner.keyboard.press('Enter');
    await acceptKey.waitFor();
    assert.deepEqual(await Promise.all(pages.map(snapshot)), before, 'resuming does not rewrite identities, owner binding or grant');
    assert.equal(providerRequests.length, 0);
  }
  await acceptKey.evaluate(button => button.click());
  assert.equal(await noAcceptedOwner(), true, 'synthetic activation cannot accept an owner or request delivery');
  assert.deepEqual((await new AxeBuilder({page: candidate}).analyze()).violations.map(v => v.id), []);
  if (process.env.INTERRUPT_ACCEPTANCE === '1') await candidate.evaluate(() => {
    const send = RTCDataChannel.prototype.send;
    window.withheldSharingMessages = 0;
    RTCDataChannel.prototype.send = function(...args) { window.withheldSharingMessages++; };
    window.restoreSharingTransport = () => { RTCDataChannel.prototype.send = send; };
  });
  if (process.env.LOSE_KEY_CONFIRMATION === '1') await candidate.evaluate(() => {
    const send = RTCDataChannel.prototype.send;
    window.sharingSends = 0; window.droppedConfirmation = 0;
    RTCDataChannel.prototype.send = function(...args) {
      if (++window.sharingSends === 1) return send.apply(this, args);
      window.droppedConfirmation++;
    };
  });
  if (process.env.LOSE_KEY_DELIVERY === '1') await owner.evaluate(() => {
    window.droppedKeyDelivery = 0;
    // Policy has already reached the recipient. Withhold the owner's next
    // encrypted delivery; preserve all real journal and recipient storage work.
    RTCDataChannel.prototype.send = function() { window.droppedKeyDelivery++; };
  });
  await acceptKey.focus(); await candidate.keyboard.press('Enter');
  if (process.env.INTERRUPT_ACCEPTANCE === '1' || process.env.LOSE_KEY_DELIVERY === '1') {
    await candidate.getByRole('heading', {name: 'Receiving the shared key', exact: true}).waitFor();
    if (process.env.LOSE_KEY_DELIVERY === '1') await owner.waitForFunction(() => window.droppedKeyDelivery > 0);
    else await candidate.waitForFunction(() => window.withheldSharingMessages > 0);
    const snapshot = () => candidate.evaluate(async () => {
      const store = await (await import('../experiments/tg-pairing/storage.mjs')).openBrowserStorage(window.testDeviceDatabase);
      try {
        const record = (await store.read('candidate-persona', 'active')).value.record;
        const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
        const group = hex(record.group), anchor = await store.read('along-at-owners', group);
        const policy = await store.read('along-at-policy:' + anchor.value.owner, group + ':' + anchor.value.credential);
        const secret = await store.read('along-at-secret:' + anchor.value.owner, group + ':' + anchor.value.credential);
        return {group, member: hex(record.subject), owner: anchor.value.owner, credential: anchor.value.credential,
          anchorRevision: anchor.revision, policyRevision: policy.revision, missingKey: secret === null};
      } finally { store.close(); }
    });
    const before = await snapshot();
    assert.equal(before.missingKey, true); assert.equal(await noAcceptedOwner(), false);
    if (process.env.LOSE_KEY_DELIVERY === '1') {
      pendingLostDelivery = await owner.evaluate(async saved => {
        const store = await (await import('../experiments/tg-pairing/storage.mjs')).openBrowserStorage(window.testDeviceDatabase);
        try { return await (await import('../experiments/at-credentials/delivery-history.mjs')).openDeliveryHistory({store, ...saved, recipient: saved.member}).read(); }
        finally { store.close(); }
      }, before);
      assert.equal(pendingLostDelivery.status, 'pending');
      assert.equal(await owner.getByRole('heading', {name: 'Other device saved the key', exact: true}).count(), 0);
    }
    // Destroy the connection and start fresh documents, preserving the actual
    // committed owner acceptance. No storage records are seeded or modified.
    await Promise.all(pages.map(page => page.reload()));
    await Promise.all(pages.map(restoreSetup));
    await owner.getByRole('button', {name: 'Share my AT key', exact: true}).click();
    await candidate.getByRole('button', {name: 'Receive a shared AT key', exact: true}).click();
    await owner.getByRole('heading', {name: 'Share your AT key', exact: true}).waitFor();
    const wrongDescriptor = JSON.parse(await owner.getByLabel('Device message to copy').inputValue());
    wrongDescriptor.credential = (wrongDescriptor.credential[0] === '0' ? '1' : '0') + wrongDescriptor.credential.slice(1);
    await candidate.getByLabel('AT-key sharing message', {exact: true}).fill(JSON.stringify(wrongDescriptor));
    await candidate.getByRole('button', {name: 'Review sharing device', exact: true}).click();
    await candidate.getByRole('heading', {name: 'Sharing is not confirmed', exact: true}).waitFor();
    assert.deepEqual(await snapshot(), before, 'a different credential descriptor cannot replace the saved choice');
    await candidate.getByRole('button', {name: 'Back', exact: true}).click();
    await restoreSetup(candidate);
    await candidate.getByRole('button', {name: 'Receive a shared AT key', exact: true}).click();
    await move(owner, candidate, 'AT-key sharing message', 'Review sharing device');
    await candidate.getByRole('button', {name: 'Connect to this sharing device', exact: true}).click();
    await candidate.getByRole('heading', {name: 'Connect for key sharing', exact: true}).waitFor();
    await move(candidate, owner, 'Sharing connection request', 'Connect for key sharing');
    await owner.getByRole('heading', {name: 'Send the sharing reply', exact: true}).waitFor();
    await move(owner, candidate, 'Sharing connection reply', 'Check sharing connection');
    const retry = owner.getByRole('button', {name: process.env.LOSE_KEY_DELIVERY === '1' ? 'Retry key delivery instead' : 'Continue sharing my key', exact: true});
    await retry.waitFor(); await retry.evaluate(button => button.click());
    assert.equal(await candidate.getByRole('button', {name: 'Receive the shared key', exact: true}).count(), 0);
    await retry.focus(); await owner.keyboard.press('Enter');
    const receive = candidate.getByRole('button', {name: 'Receive the shared key', exact: true});
    await receive.waitFor();
    assert.equal(await candidate.getByRole('button', {name: 'Allow this device to receive the key', exact: true}).count(), 0);
    await receive.evaluate(button => button.click());
    assert.deepEqual(await snapshot(), before, 'resume preserves accepted owner/policy and synthetic activation cannot request a key');
    await receive.focus(); await candidate.keyboard.press('Enter');
    console.log('Acceptance interruption: restored the actual saved owner choice and explicitly resumed delivery.');
  }
  await candidate.getByRole('heading', {name: 'Shared AT key saved', exact: true}).waitFor();
  if (process.env.LOSE_KEY_CONFIRMATION === '1') {
    await candidate.waitForFunction(() => window.droppedConfirmation > 0);
    const snapshot = page => page.evaluate(async () => {
      const store = await (await import('../experiments/tg-pairing/storage.mjs')).openBrowserStorage(window.testDeviceDatabase);
      try {
        const record = (await store.read('candidate-persona', 'active')).value.record;
        const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
        const group = hex(record.group), anchor = await store.read('along-at-owners', group);
        const key = group + ':' + anchor.value.credential;
        const secret = await store.read('along-at-secret:' + anchor.value.owner, key);
        const policy = await store.read('along-at-policy:' + anchor.value.owner, key);
        return {member: hex(record.subject), binding: {group, owner: anchor.value.owner, credential: anchor.value.credential},
          anchorRevision: anchor.revision, policyRevision: policy.revision, secretRevision: secret.revision,
          ciphertextHash: hex(new Uint8Array(await crypto.subtle.digest('SHA-256', secret.value.ciphertext)))};
      } finally { store.close(); }
    });
    const before = await Promise.all(pages.map(snapshot));
    const historyState = () => owner.evaluate(async recipient => {
      const store = await (await import('../experiments/tg-pairing/storage.mjs')).openBrowserStorage(window.testDeviceDatabase);
      try {
        return await (await import('../experiments/at-credentials/delivery-history.mjs')).openDeliveryHistory({store, ...recipient.binding, recipient: recipient.member}).read();
      } finally { store.close(); }
    }, before[0]);
    assert.equal((await historyState()).status, 'pending');
    assert.equal(await owner.getByRole('heading', {name: 'Other device saved the key', exact: true}).count(), 0);
    await Promise.all(pages.map(page => page.reload()));
    await Promise.all(pages.map(restoreSetup));
    await owner.getByRole('button', {name: 'Share my AT key', exact: true}).click();
    await candidate.getByRole('button', {name: 'Receive a shared AT key', exact: true}).click();
    await owner.getByRole('heading', {name: 'Share your AT key', exact: true}).waitFor();
    await move(owner, candidate, 'AT-key sharing message', 'Review sharing device');
    await candidate.getByRole('button', {name: 'Connect to this sharing device', exact: true}).click();
    await candidate.getByRole('heading', {name: 'Connect for key sharing', exact: true}).waitFor();
    await move(candidate, owner, 'Sharing connection request', 'Connect for key sharing');
    await owner.getByRole('heading', {name: 'Send the sharing reply', exact: true}).waitFor();
    await move(owner, candidate, 'Sharing connection reply', 'Check sharing connection');
    const checkReceipt = owner.getByRole('button', {name: 'Check saved confirmation', exact: true});
    await checkReceipt.waitFor(); await checkReceipt.evaluate(button => button.click());
    assert.equal(await candidate.getByRole('button', {name: 'Send saved confirmation', exact: true}).count(), 0);
    await checkReceipt.focus(); await owner.keyboard.press('Enter');
    const sendReceipt = candidate.getByRole('button', {name: 'Send saved confirmation', exact: true});
    await sendReceipt.waitFor(); await sendReceipt.evaluate(button => button.click());
    assert.equal((await historyState()).status, 'pending');
    await sendReceipt.focus(); await candidate.keyboard.press('Enter');
    await candidate.getByRole('heading', {name: 'Saved confirmation sent', exact: true}).waitFor();
    await owner.getByRole('heading', {name: 'Other device saved the key', exact: true}).waitFor();
    assert.equal((await historyState()).status, 'recipient-confirmed-saved');
    assert.deepEqual(await Promise.all(pages.map(snapshot)), before, 'receipt recovery preserves identities, bindings, policies and exact encrypted key records');
    assert.equal(providerRequests.length, 0);
    console.log('Lost confirmation: actual pending delivery recovered through visible receipt controls without replacing either encrypted key.');
  }
  await owner.getByRole('heading', {name: 'Other device saved the key', exact: true}).waitFor();
  if (pendingLostDelivery) {
    const confirmed = await owner.evaluate(async previous => {
      const store = await (await import('../experiments/tg-pairing/storage.mjs')).openBrowserStorage(window.testDeviceDatabase);
      try { return await (await import('../experiments/at-credentials/delivery-history.mjs')).openDeliveryHistory({store, ...previous.context}).read(); }
      finally { store.close(); }
    }, pendingLostDelivery);
    assert.equal(confirmed.status, 'recipient-confirmed-saved');
    assert.notEqual(confirmed.context.nonce, pendingLostDelivery.context.nonce, 'retry has a fresh delivery context');
    assert.equal(confirmed.context.policyRevision, pendingLostDelivery.context.policyRevision);
    assert.equal(confirmed.context.generation, pendingLostDelivery.context.generation);
    console.log('Lost delivery: pending send was retried through explicit controls with a fresh nonce and unchanged permission/generation.');
  }
  assert.equal(providerRequests.length, 0);
  if (replaceSharedKey) {
    const keyState = page => page.evaluate(async () => {
      const wasm = await import('../experiments/tg-pairing/hive_wasm.js');
      const store = await (await import('../experiments/tg-pairing/storage.mjs')).openBrowserStorage(window.testDeviceDatabase);
      try {
        const record = (await store.read('candidate-persona', 'active')).value.record;
        const {binding} = await (await import('../experiments/at-credentials/local-owner.mjs')).loadATBinding({wasm, store, expectedGroup: record.group});
        const vault = (await import('../experiments/at-credentials/local-vault.mjs')).openLocalATVault({wasm, store, ...binding});
        const policy = await (await import('../experiments/at-credentials/policy-store.mjs')).openCredentialPolicyStore({store, ...binding}).read();
        const usable = await vault.getKey().then(() => true, () => false);
        return {member: [...record.subject], generation: String(policy.policy.generation), devices: policy.policy.devices,
          state: (await vault.inspect()).status, usable};
      } finally { store.close(); }
    });
    const beforeOwner = await keyState(owner), beforeRecipient = await keyState(candidate);
    for (const page of pages) await page.getByRole('button', {name: 'Back', exact: true}).click();
    await owner.getByRole('button', {name: 'Manage my AT key', exact: true}).click();
    await owner.getByRole('button', {name: 'Replace AT key', exact: true}).click();
    await owner.getByRole('button', {name: 'Continue to replacement key', exact: true}).click();
    await owner.getByRole('heading', {name: 'Add your replacement AT key', exact: true}).waitFor();
    // Leaving after generation advancement must preserve a recoverable state.
    await owner.getByRole('button', {name: 'Back', exact: true}).click();
    const waitingOwner = await keyState(owner);
    assert.equal(waitingOwner.state, 'replacement-needed');
    assert.equal(waitingOwner.usable, false, 'owner cannot use its previous key after advancing generation');
    assert.deepEqual(waitingOwner.member, beforeOwner.member);
    assert.deepEqual(waitingOwner.devices, beforeOwner.devices);
    assert.equal(BigInt(waitingOwner.generation), BigInt(beforeOwner.generation) + 1n);
    await owner.getByRole('button', {name: 'Manage my AT key', exact: true}).click();
    await owner.getByLabel('Personal AT API key', {exact: true}).fill('synthetic-two-app-replacement');
    await owner.getByRole('button', {name: 'Save key on this device', exact: true}).click();
    await owner.getByRole('heading', {name: 'AT key saved on this device', exact: true}).waitFor();
    await owner.getByRole('button', {name: 'Back', exact: true}).click();
    await owner.getByRole('button', {name: 'Share my AT key', exact: true}).click();
    await candidate.getByRole('button', {name: 'Receive a shared AT key', exact: true}).click();
    await owner.getByRole('heading', {name: 'Share your AT key', exact: true}).waitFor();
    await move(owner, candidate, 'AT-key sharing message', 'Review sharing device');
    await candidate.getByRole('button', {name: 'Connect to this sharing device', exact: true}).click();
    await candidate.getByRole('heading', {name: 'Connect for key sharing', exact: true}).waitFor();
    await move(candidate, owner, 'Sharing connection request', 'Connect for key sharing');
    await owner.getByRole('heading', {name: 'Send the sharing reply', exact: true}).waitFor();
    await move(owner, candidate, 'Sharing connection reply', 'Check sharing connection');
    await owner.getByRole('button', {name: 'Continue sharing my key', exact: true}).click();
    await candidate.getByRole('button', {name: 'Receive replacement key', exact: true}).waitFor();
    const waitingRecipient = await keyState(candidate);
    assert.equal(waitingRecipient.state, 'replacement-needed');
    assert.equal(waitingRecipient.usable, false, 'recipient cannot use old key after learning replacement generation');
    assert.deepEqual(waitingRecipient.member, beforeRecipient.member);
    assert.equal(waitingRecipient.generation, waitingOwner.generation);
    await candidate.getByRole('button', {name: 'Receive replacement key', exact: true}).click();
    await candidate.getByRole('heading', {name: 'Shared AT key saved', exact: true}).waitFor();
    await owner.getByRole('heading', {name: 'Other device saved the key', exact: true}).waitFor();
    assert.equal((await keyState(candidate)).usable, true);
    assert.equal(providerRequests.length, 0);
    console.log('PASS: owner replacement resumes after Back, advances generation once, and reaches recipient through existing consent without changing identities or grants; old keys are refused after generation catch-up.');
  }
  await candidate.setViewportSize({width: 1280, height: 900});
  if (mainSetup) {
    for (const page of pages) {
      await page.getByRole('button', {name: 'Back', exact: true}).click();
      await page.getByRole('button', {name: 'Back to settings', exact: true}).click();
      await page.getByRole('button', {name: 'Close settings', exact: true}).click();
    }
  } else await Promise.all(pages.map(page => page.goto(origin + 'public/')));
  await Promise.all(pages.map(page => expect(page.locator('#data-status')).toContainText('offline ready', {timeout: 90000})));
  for (const page of pages) {
    await page.locator('#settings-open').click();
    await page.getByRole('button', {name: 'Connect an existing AT-key device', exact: true}).click();
    await page.getByRole('button', {name: 'Connect devices', exact: true}).click();
  }
  await candidate.getByRole('heading', {name: 'Connect to your AT-key device', exact: true}).waitFor();
  await move(candidate, owner, 'Connection request', 'Prepare connection reply');
  await owner.getByRole('heading', {name: 'Reply to your other device', exact: true}).waitFor();
  await move(owner, candidate, 'Connection reply', 'Connect devices');
  for (const page of pages) {
    await page.getByRole('button', {name: 'Use this connection', exact: true}).click();
    await page.getByRole('heading', {name: 'Your devices are connected', exact: true}).waitFor();
    await page.getByRole('button', {name: 'Back to settings', exact: true}).click();
    await page.getByRole('button', {name: 'Close settings', exact: true}).click();
  }
  assert.equal(providerRequests.length, 0);
  const choose = async (field, query) => {
    const input = candidate.locator('#' + field); await input.fill(query);
    await expect(candidate.locator('#' + field + '-options [data-index]').first()).toBeVisible();
    await input.press('ArrowDown'); await input.press('Enter');
  };
  await choose('destination', '10 Victoria Road Devonport'); await candidate.locator('#destination-next').click();
  await choose('origin', '277 Broadway Newmarket'); await candidate.locator('#origin-next').click();
  await candidate.locator('#journey-preferences > summary').click();
  await candidate.locator('#date').fill('2026-09-23'); await candidate.locator('#time').fill('09:00'); await candidate.locator('#find').click();
  await expect(candidate.locator('.journey-card').first()).toBeVisible({timeout: 30000});
  await expect(candidate.locator('.journey-card').first()).toContainText('Ferry');
  await candidate.locator('[data-follow]').first().click();
  const step = await candidate.locator('#current-step').textContent();
  await candidate.locator('#journey-alert-check').click();
  await expect(candidate.locator('#journey-prediction-results')).toContainText('No live departure match', {timeout: 15000});
  assert.deepEqual(providerRequests.sort(), ['/realtime/legacy/servicealerts', '/realtime/legacy/tripupdates']);
  assert.equal((await candidate.locator('body').textContent()).includes('synthetic-two-app-key'), false);
  assert.equal((await candidate.locator('body').textContent()).includes('synthetic-two-app-replacement'), false);
  // Save removal through Settings without pushing it: the next contextual read
  // must learn the signed owner change before AT receives another request.
  const ownerPolicy = () => owner.evaluate(async () => {
    const wasm = await import('../experiments/tg-pairing/hive_wasm.js');
    const store = await (await import('../experiments/tg-pairing/storage.mjs')).openBrowserStorage(window.testDeviceDatabase);
    try {
      const record = (await store.read('candidate-persona', 'active')).value.record;
      const {binding} = await (await import('../experiments/at-credentials/local-owner.mjs')).loadATBinding({wasm, store, expectedGroup: record.group});
      const loaded = await (await import('../experiments/at-credentials/policy-store.mjs')).openCredentialPolicyStore({store, ...binding}).read();
      return {owner: binding.owner, devices: loaded.policy.devices, revision: String(loaded.policy.revision)};
    } finally { store.close(); }
  });
  const beforeRemoval = await ownerPolicy();
  await owner.locator('#settings-open').click();
  await owner.getByRole('button', {name: 'Device and AT-key setup', exact: true}).click();
  await owner.getByRole('button', {name: 'Manage AT access on other devices', exact: true}).click();
  const device = owner.getByRole('button', {name: /^Device [0-9a-f]{8}/});
  await device.click();
  await owner.getByRole('heading', {name: 'Remove this device’s AT access?', exact: true}).waitFor();
  await owner.getByRole('button', {name: 'Back', exact: true}).click();
  assert.deepEqual(await ownerPolicy(), beforeRemoval, 'Back does not change access');
  await device.click();
  await owner.getByRole('button', {name: 'Remove AT access', exact: true}).waitFor();
  await owner.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Remove AT access').click());
  assert.deepEqual(await ownerPolicy(), beforeRemoval, 'synthetic activation cannot remove access');
  await owner.setViewportSize({width: 320, height: 640});
  await owner.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  assert.equal(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual((await new AxeBuilder({page: owner}).include('dialog[open]').analyze()).violations.map(v => v.id), []);
  await owner.getByRole('button', {name: 'Remove AT access', exact: true}).focus();
  await owner.keyboard.press('Enter');
  await owner.getByRole('heading', {name: 'Access removal saved', exact: true}).waitFor();
  assert.equal(await owner.evaluate(() => document.activeElement.textContent), 'Back');
  const removed = await ownerPolicy();
  assert.deepEqual(removed.devices, [beforeRemoval.owner]);
  assert.equal(BigInt(removed.revision), BigInt(beforeRemoval.revision) + 1n);
  await owner.getByRole('button', {name: 'Back', exact: true}).click();
  await owner.getByText('No other devices have permission to use your AT key.', {exact: true}).waitFor();
  await owner.getByRole('button', {name: 'Back', exact: true}).click();
  await owner.getByRole('button', {name: 'Back to settings', exact: true}).click();
  await owner.getByRole('button', {name: 'Close settings', exact: true}).click();
  await owner.setViewportSize({width: 1280, height: 900});
  await owner.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await candidate.locator('#journey-alert-check').click();
  await expect(candidate.locator('#journey-prediction-results')).toContainText('Live departure predictions unavailable', {timeout: 15000});
  assert.equal(providerRequests.length, 2);
  await owner.locator('#settings-open').click();
  await owner.getByRole('button', {name: 'Connect an existing AT-key device', exact: true}).click();
  await owner.getByRole('button', {name: 'Disconnect devices', exact: true}).click();
  await expect(candidate.locator('#journey-live')).toBeHidden({timeout: 15000});
  assert.equal(await candidate.locator('#current-step').textContent(), step);
  assert.equal(providerRequests.length, 2);
  await candidate.evaluate(async () => { await navigator.serviceWorker.ready; });
  await candidate.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await contexts[0].setOffline(true);
  await candidate.reload();
  await expect(candidate.locator('#data-status')).toContainText('offline ready', {timeout: 90000});
  await choose('destination', '1 Queen Street Auckland Central'); await candidate.locator('#destination-next').click();
  await choose('origin', '277 Broadway Newmarket'); await candidate.locator('#origin-next').click();
  await candidate.locator('#find').click();
  await expect(candidate.locator('.journey-card').first()).toBeVisible({timeout: 30000});
  await candidate.locator('[data-follow]').first().click();
  await expect(candidate.locator('#journey-live')).toBeHidden();
  assert.equal(providerRequests.length, 2);
  assert.deepEqual(errors, []);
  console.log('PASS: two isolated browser app instances restore actual enrollment and encrypted WebRTC-delivered key, reconnect through Settings, close Settings, request contextual mocked AT feeds for a real bus/ferry journey, learn withheld removal before further provider I/O, disconnect without changing the selected step, and reopen/route offline. Setup, grant, consent and removal use visible controls; one host, not physical devices or real provider verification.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
