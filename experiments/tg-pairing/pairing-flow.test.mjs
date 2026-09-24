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
if (process.env.ROTATED_ISSUER === '1') for (const name of ['epoch-transition.mjs', 'epoch-preparation.mjs', 'epoch-installation.mjs']) sources.set('/' + name, await readFile(new URL(name, import.meta.url)));
for (const name of ['enrollment-profile.mjs', 'enrollment-payloads.mjs', 'core-candidate-session.mjs', 'software-traffic.mjs', 'initial-persona.mjs', 'software-persona.mjs', 'software-invitation.mjs', 'invitation-proof.mjs', 'transfer-view.mjs', 'pairing-flow.mjs', 'comparison.mjs', 'comparison.css', 'receive-invitation-view.mjs', 'stored-claim.mjs', 'installation-receipt.mjs', 'local-persona.mjs', 'local-persona-session.mjs', 'epoch-watch.mjs', 'receipt-recovery.mjs', 'recovery-flow.mjs']) sources.set('/' + name, await readFile(new URL('./' + name, import.meta.url)));
if (process.env.RECOVERY_MODULE) sources.set('/receipt-recovery.mjs', await readFile(process.env.RECOVERY_MODULE));
for (const name of ['hive_wasm.js', 'hive_wasm_bg.wasm']) sources.set('/' + name, await readFile(join(process.env.R2_WASM_DIR, name)));
for (const name of ['qr-transfer.mjs', 'vendor/qrcode.mjs']) sources.set('/' + name, await readFile(new URL(name, import.meta.url)));
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
    if (index === 1 && process.env.TIMEOUT_FLOW === '1') await page.clock.install();
    await page.evaluate(async ({index, loseInstallReply, loseAckReply, recoverConnection, rotatedIssuer}) => {
      window.wasm = await import('./hive_wasm.js'); await wasm.default();
      window.store = await (await import('./storage.mjs')).openBrowserStorage('pairing-flow');
      const initial = await (await import('./software-persona.mjs')).initializeSoftwarePersona({wasm, store});
      window.group = Uint8Array.from(initial.group.match(/../g), b => parseInt(b, 16));
      if (index === 1 && rotatedIssuer) {
        const staleInvitation = await (await import('./software-invitation.mjs')).createSoftwareInvitation({wasm, store, expectedGroup: group});
        const issuer = await (await import('./software-persona.mjs')).loadSoftwareIssuer({wasm, store, expectedGroup: group});
        try { await issuer.prepareRotation(); }
        finally { issuer.close(); }
        await (await import('./epoch-installation.mjs')).installPreparedIssuerEpoch({wasm, store, expectedGroup: group, epoch: 1n});
        if (await staleInvitation.respondChallenge(crypto.getRandomValues(new Uint8Array(16))).then(() => true, () => false)) throw Error('Old-epoch invitation survived advancement');
        staleInvitation.close();
      }
      let flowStore = store;
      if (index === 0 && (loseInstallReply || loseAckReply)) {
        flowStore = {...store, compareAndSwapMany: async (...args) => {
          const result = await store.compareAndSwapMany(...args);
          if (result.applied && args[0].some(write => write.scope === 'candidate-persona' && write.value?.invitation && write.value.peerAcknowledged === loseAckReply)) {
            window.commitSaved = true;
            await new Promise(resolve => { window.releaseCommit = resolve; });
          }
          return result;
        }};
      }
      if (index === 1 && recoverConnection) {
        flowStore = {...store, compareAndSwapMany: async (...args) => {
          const result = await store.compareAndSwapMany(...args);
          if (result.applied && args[0].some(write => write.scope === 'enrollment-installations')) {
            window.receiptSaved = true;
            await new Promise(resolve => { window.releaseReceipt = resolve; });
          }
          return result;
        }};
      }
      window.flow = (await import('./pairing-flow.mjs')).showPairingFlow(document.querySelector('#flow'),
        {wasm, store: flowStore, role: index ? 'provisioner' : 'candidate', expectedGroup: group, focus: true});
    }, {index, loseInstallReply: process.env.LOSE_INSTALL_REPLY === '1', loseAckReply: process.env.LOSE_ACK_REPLY === '1', recoverConnection: process.env.RECOVER_CONNECTION === '1', rotatedIssuer: process.env.ROTATED_ISSUER === '1'});
  }));
  const [candidate, owner] = pages;
  await owner.getByRole('heading', {name: 'Invite your other device', exact: true}).waitFor();
  if (process.env.TIMEOUT_FLOW === '1') {
    const before = await owner.evaluate(async () => (await store.read('candidate-persona', 'active')).revision);
    await owner.clock.fastForward(65000);
    await owner.getByRole('heading', {name: 'Connection did not finish', exact: true}).waitFor();
    assert.match(await owner.getByRole('status').textContent(), /exchange ended during: Invite your other device/);
    assert.match(await owner.getByRole('status').textContent(), /Invitations expire after one minute/);
    assert.equal(await owner.evaluate(async () => (await store.read('candidate-persona', 'active')).revision), before);
    await owner.clock.resume();
    await owner.evaluate(async () => {
      flow.dispose();
      window.flow = (await import('./pairing-flow.mjs')).showPairingFlow(document.querySelector('#flow'),
        {wasm, store, role: 'provisioner', expectedGroup: group, focus: true});
    });
    await owner.getByRole('heading', {name: 'Invite your other device', exact: true}).waitFor();
    console.log('PASS: expired invitation identifies the unfinished step and preserves identity before retry.');
  }
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
    for (const page of pages) {
      assert.match(await page.getByRole('status').textContent(), /exchange ended during: Connecting to your other device/);
      assert.match(await page.getByRole('status').textContent(), /Keep your saved device data/);
    }
    assert.equal(await candidate.evaluate(async () => (await store.read('candidate-persona', 'active')).value.origin), 'initial');
    console.log('PASS: rejecting comparison ends both flows and preserves the candidate’s initial membership.');
  } else {
  await Promise.all(pages.map(async page => {
    await page.getByRole('button', {name: 'Both devices are here and the codes match', exact: true}).click();
  }));
  if (process.env.RECOVER_CONNECTION === '1') {
    await owner.waitForFunction(() => window.receiptSaved === true);
    await owner.evaluate(() => flow.dispose());
    await owner.evaluate(() => releaseReceipt());
    await candidate.getByRole('heading', {name: 'Device group saved locally', exact: true}).waitFor();
    const before = await candidate.evaluate(async () => {
      const saved = await store.read('candidate-persona', 'active');
      return {member: [...saved.value.record.subject], revision: saved.revision, acknowledged: saved.value.peerAcknowledged};
    });
    assert.equal(before.acknowledged, false);
    // Fresh documents restore real committed records; no fabricated membership or acknowledgment.
    await Promise.all(pages.map(page => page.reload()));
    const mountRecovery = async (page, index) => page.evaluate(async index => {
      window.wasm = await import('./hive_wasm.js'); await wasm.default();
      window.store = await (await import('./storage.mjs')).openBrowserStorage('pairing-flow');
      const saved = await store.read('candidate-persona', 'active');
      window.flow = (await import('./recovery-flow.mjs')).showRecoveryFlow(document.querySelector('#flow'),
        {wasm, store, expectedGroup: saved.value.record.group, role: index ? 'provisioner' : 'candidate', focus: true});
    }, index);
    await Promise.all(pages.map(mountRecovery));
    await candidate.getByRole('heading', {name: 'Recover installation confirmation', exact: true}).waitFor();
    // Cancel before exchange and prove no confirmation write; then retry fresh sessions.
    await candidate.getByRole('button', {name: 'Back', exact: true}).click();
    assert.equal(await candidate.evaluate(async () => (await store.read('candidate-persona', 'active')).revision), before.revision);
    await owner.evaluate(() => flow.dispose());
    await Promise.all(pages.map(mountRecovery));
    await candidate.getByRole('heading', {name: 'Recover installation confirmation', exact: true}).waitFor();
    await owner.getByLabel('Recovery message from your other device', {exact: true}).fill('{"profile":"wrong"}');
    await owner.getByRole('button', {name: 'Prepare recovery reply', exact: true}).click();
    await owner.getByRole('heading', {name: 'Confirmation is still unverified', exact: true}).waitFor();
    assert.equal(await candidate.evaluate(async () => (await store.read('candidate-persona', 'active')).revision), before.revision);
    await owner.evaluate(() => flow.dispose());
    await mountRecovery(owner, 1);
    await move(candidate, owner, 'Recovery message from your other device', 'Prepare recovery reply');
    await owner.getByRole('heading', {name: 'Send the recovery reply', exact: true}).waitFor();
    for (const page of pages) {
      await page.setViewportSize({width: 320, height: 640});
      await page.evaluate(() => document.documentElement.style.fontSize = '200%');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
    }
    await move(owner, candidate, 'Recovery reply from your other device', 'Check installation confirmation');
    await candidate.getByRole('heading', {name: 'Installation confirmed', exact: true}).waitFor();
    await owner.getByRole('heading', {name: 'Installation confirmation sent', exact: true}).waitFor();
    const after = await candidate.evaluate(async () => {
      const saved = await store.read('candidate-persona', 'active');
      return {member: [...saved.value.record.subject], revision: saved.revision, acknowledged: saved.value.peerAcknowledged};
    });
    assert.deepEqual(after.member, before.member); assert.equal(after.acknowledged, true); assert.equal(after.revision, before.revision + 1);
    console.log('PASS: lost confirmation recovered through visible transfer controls in fresh documents; authenticated saved receipt, same identity, cancellation without writes, narrow-screen reflow and axe checks.');
  } else if (process.env.LOSE_INSTALL_REPLY === '1' || process.env.LOSE_ACK_REPLY === '1') {
    await candidate.waitForFunction(() => window.commitSaved === true);
    await owner.evaluate(() => flow.dispose());
    await candidate.getByRole('heading', {name: 'Checking saved device state', exact: true}).waitFor();
    await candidate.evaluate(() => releaseCommit());
    const acknowledged = process.env.LOSE_ACK_REPLY === '1';
    await candidate.getByRole('heading', {name: acknowledged ? 'Device connected' : 'Device group saved locally', exact: true}).waitFor();
    assert.equal(await candidate.getByRole('status').textContent(), acknowledged
      ? 'This device saved its group membership and confirmation before the connection ended.'
      : 'This device joined the group, but confirmation from the other device was not completed. Keep the saved device data for recovery.');
    const saved = await candidate.evaluate(async () => {
      const persona = await store.read('candidate-persona', 'active');
      return {claim: persona.value.claim, acknowledged: persona.value.peerAcknowledged};
    });
    assert.deepEqual(saved, {claim: 'owner', acknowledged});
    console.log('PASS: transport loss after atomic commit but before completion delivery preserves membership and reports its durable confirmation state:', acknowledged ? 'acknowledged' : 'installed locally');
  } else {
  await candidate.getByRole('heading', {name: 'Device connected', exact: true}).waitFor();
  await owner.getByRole('heading', {name: 'Other device installed', exact: true}).waitFor();
  const target = await owner.evaluate(() => [...group]);
  assert.equal(await candidate.evaluate(async ({group, epoch}) => {
    const restored = await (await import('./local-persona.mjs')).loadLocalPersona({wasm, store, expectedGroup: new Uint8Array(group)});
    const traffic = await (await import('./software-traffic.mjs')).loadSoftwareTraffic({wasm, store, expectedGroup: new Uint8Array(group)});
    try { return restored.origin === 'enrolled' && restored.peerAcknowledged && restored.epoch === BigInt(epoch) && traffic.epoch === BigInt(epoch); }
    finally { traffic.destroy(); }
  }, {group: target, epoch: process.env.ROTATED_ISSUER === '1' ? 1 : 0}), true);
  }
  }
  await Promise.all(pages.map(page => page.evaluate(() => flow.dispose())));
  if (process.env.RECOVER_CONNECTION !== '1' && process.env.CANCEL_FLOW !== '1' && process.env.LOSE_INSTALL_REPLY !== '1' && process.env.LOSE_ACK_REPLY !== '1') console.log('PASS: both complete pairing flows exchange public messages through fields, compare codes, enroll over real WebRTC, acknowledge installation and restore encrypted traffic keys. Harness transfers text and confirms codes; no physical-device usability claim.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
