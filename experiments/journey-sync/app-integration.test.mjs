// Generated journey app in two isolated profiles. Real UI enrollment and saved
// places; the harness copies public connection text. No AT key or provider needed.
import assert from 'node:assert/strict';
import {checkAppRotation} from '../at-credentials/rotation-app-check.mjs';
import AxeBuilder from '@axe-core/playwright';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join, extname} from 'node:path';
const {chromium, expect} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const mainSetup = true;
const preview = process.env.PREVIEW === '1';
const legacyEnrollment = process.env.LEGACY_ENROLLMENT === '1';
assert.ok(!legacyEnrollment || preview, 'Legacy upgrade uses the preview storage profile');
const root = new URL(preview ? '../../releases/along-device-preview/' : '../../releases/along-experimental-app/', import.meta.url).pathname;
const manifest = JSON.parse(await readFile(join(root, 'build-info.json'), 'utf8'));
assert.equal(manifest.profile, preview ? 'along-device-preview-v1' : 'along-experimental-app-v1');
const namespaces = manifest.namespaces ?? {preferences: 'along-journeys-v1', devices: 'along-pairing-lab-v1'};
assert.equal(Object.keys(manifest.files).some(name => /APIKey|\.test\./.test(name)), false);
const sources = new Map(await Promise.all(Object.entries(manifest.files).map(async ([name, hash]) => {
  const bytes = await readFile(join(root, name));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hash); return [name, bytes];
})));
let serving = sources;
if (legacyEnrollment) {
  const oldRoot = new URL('../../releases/along-device-preview-3801/', import.meta.url).pathname;
  const bytes = await readFile(join(oldRoot, 'build-info.json'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '8b0a756dd753421eee91b1412f6150e2eb209ac1db36c2cd820bb85cf5e31e32');
  const old = JSON.parse(bytes); assert.deepEqual(old.namespaces, namespaces);
  serving = new Map(await Promise.all(Object.entries(old.files).map(async ([name, hash]) => {
    const body = await readFile(join(oldRoot, name));
    assert.equal(createHash('sha256').update(body).digest('hex'), hash); return [name, body];
  })));
}
const prefix = '/along-exp/';
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const name = path.startsWith(prefix) ? path.slice(prefix.length) + (path.endsWith('/') ? 'index.html' : '') : '';
  const body = serving.get(name);
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
  const origin = `http://127.0.0.1:${server.address().port}${prefix}`;
  const providerRequests = [], errors = [];
  for (const page of pages) page.on('pageerror', error => errors.push(error.message));
  for (const context of contexts) await context.route('https://api.at.govt.nz/**', async route => { providerRequests.push(route.request().url()); await route.abort(); });
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

  if (legacyEnrollment) {
    const identityState = page => page.evaluate(async name => {
      const store = await (await import('../experiments/tg-pairing/storage.mjs')).openBrowserStorage(name);
      const hex = bytes => bytes && Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
      try {
        const persona = await store.read('candidate-persona', 'active'), group = hex(persona.value.record.group);
        return {revision: persona.revision, member: hex(persona.value.record.subject), certificate: hex(persona.value.record.certificate),
          issuerCiphertext: hex((await store.read('along-browser-issuer', group))?.value?.ciphertext),
          trafficCiphertext: hex((await store.read('along-browser-traffic', group))?.value?.ciphertext),
          directory: await store.read('along-issued-members-v1', group)};
      } finally { store.close(); }
    }, namespaces.devices);
    const old = await Promise.all(pages.map(identityState));
    assert.ok(old.every(value => value.directory === null));
    serving = sources;
    for (const page of pages) {
      await page.goto(origin + 'public/update.html');
      await page.locator('#recover-update').click();
      await expect(page.locator('#recovery-status')).toContainText(manifest.appVersion, {timeout: 60000});
      await page.locator('#recover-update').click();
      await expect(page.locator('#address-status')).toContainText('ready offline', {timeout: 60000});
    }
    assert.deepEqual(await Promise.all(pages.map(identityState)), old, 'upgrade does not recreate identities, traffic material or issuer custody');
    await owner.evaluate(async databaseName => {
      const wasm = await import('../experiments/tg-pairing/hive_wasm.js'); await wasm.default();
      const store = await (await import('../experiments/tg-pairing/storage.mjs')).openBrowserStorage(databaseName);
      const {restoreIssuedMembers} = await import('../experiments/tg-pairing/legacy-members.mjs');
      const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
      try {
        const group = (await store.read('candidate-persona', 'active')).value.record.group, groupId = hex(group);
        const keys = await new Promise((resolve, reject) => {
          const open = indexedDB.open('r2-browser:' + databaseName, 1); open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result, tx = db.transaction('records', 'readonly');
            const request = tx.objectStore('records').getAllKeys(IDBKeyRange.bound(['enrollment-installations', groupId + ':'], ['enrollment-installations', groupId + ':\uffff']));
            tx.oncomplete = () => { db.close(); resolve(request.result); };
            tx.onabort = () => { db.close(); reject(Error('receipt fixture unavailable')); };
          };
        });
        if (keys.length !== 1) throw Error('Expected one real legacy installation receipt');
        const key = keys[0][1], original = await store.read('enrollment-installations', key);
        const input = {wasm, store, databaseName, expectedGroup: group};
        const refuses = async options => {
          if (await restoreIssuedMembers({...input, ...options}).then(() => true, () => false)) throw Error('Invalid migration accepted');
          if (await store.read('along-issued-members-v1', groupId)) throw Error('Invalid migration wrote directory');
        };
        const damaged = structuredClone(original.value); damaged.receipt[153] ^= 1;
        await store.compareAndSwap('enrollment-installations', key, original.revision, damaged);
        await refuses();
        let held = await store.read('enrollment-installations', key);
        await store.compareAndSwap('enrollment-installations', key, held.revision, original.value);
        const journal = await store.read('enrollment-invitations', key);
        await store.compareAndSwap('enrollment-invitations', key, journal.revision, {...journal.value, state: 'void'});
        await refuses();
        held = await store.read('enrollment-invitations', key);
        await store.compareAndSwap('enrollment-invitations', key, held.revision, journal.value);
        const cancelled = new AbortController(); cancelled.abort(); await refuses({signal: cancelled.signal});
        const racingStore = {...store, compareAndSwapMany: async (...args) => {
          const latest = await store.read('enrollment-installations', key);
          await store.compareAndSwap('enrollment-installations', key, latest.revision, latest.value);
          return store.compareAndSwapMany(...args);
        }};
        await refuses({store: racingStore});
      } finally { store.close(); }
    }, namespaces.devices);
  }

  await Promise.all(pages.map(page => page.reload()));
  const preferences = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), namespaces.preferences);
  const saved = async page => (await preferences(page)).journeys.filter(j => j.saved);
  const choose = async (page, field, query) => {
    await expect(page.locator('#address-status')).toContainText('ready offline', {timeout: 60000});
    const input = page.locator('#' + field); await input.fill(query);
    await expect(page.locator('#' + field + '-options [data-index]').first()).toBeVisible({timeout: 30000});
    await input.press('ArrowDown'); await input.press('Enter');
  };
  const reviewPlaces = async (page, destination) => {
    await choose(page, 'destination', destination); await page.locator('#destination-next').click();
    await choose(page, 'origin', '277 Broadway Newmarket'); await page.locator('#origin-next').click();
  };
  const savePlaces = async (page, destination) => {
    await reviewPlaces(page, destination);
    await page.locator('#save-places').click();
    await expect(page.locator('#save-places')).toHaveAttribute('aria-pressed', 'true');
  };
  await savePlaces(owner, '10 Victoria Road Devonport');
  await owner.locator('#journey-preferences > summary').click();
  await owner.locator('#date').fill('2026-09-23'); await owner.locator('#time').fill('09:00'); await owner.locator('#find').click();
  await expect(owner.locator('.journey-card').first()).toBeVisible({timeout: 30000});
  await owner.locator('[data-follow]').first().click(); await owner.locator('#prefer-services').click();
  await expect(owner.locator('#prefer-services')).toHaveAttribute('aria-pressed', 'true');
  const originalStep = await owner.locator('#current-step').textContent();
  const preferred = (await saved(owner))[0]; assert.ok(preferred.savedRoutes.length);
  await savePlaces(candidate, '1 Queen Street Auckland Central');
  const share = async page => {
    await page.locator('#settings-open').click();
    await page.getByRole('button', {name: 'Share saved journeys with my devices', exact: true}).click();
  };
  const closeSharing = async page => {
    await page.getByRole('button', {name: 'Back to settings', exact: true}).click();
    await page.getByRole('button', {name: 'Close settings', exact: true}).click();
  };
  await share(owner);
  await owner.getByRole('button', {name: 'Manage journey-sharing devices', exact: true}).click();
  await expect(owner.getByRole('dialog', {name: 'Saved journey sharing'})).toContainText('No other devices have permission here');
  assert.equal((await preferences(owner)).journeySync, undefined, 'listing permissions does not opt into sharing');
  await owner.getByRole('button', {name: 'Back', exact: true}).click(); await closeSharing(owner);
  const connectJourneys = async () => {
    await Promise.all(pages.map(share));
    await owner.getByRole('button', {name: 'Start journey connection', exact: true}).click();
    await candidate.getByRole('button', {name: 'Join journey connection', exact: true}).click();
    await move(owner, candidate, 'Journey device message', 'Review journey device');
    await candidate.getByRole('button', {name: /^(Allow journey sharing|Connect this device)$/}).click();
    await candidate.getByRole('heading', {name: 'Send the journey connection request', exact: true}).waitFor();
    await move(candidate, owner, 'Journey connection request', 'Review journey device');
    await owner.getByRole('button', {name: /^(Allow journey sharing|Connect this device)$/}).click();
    await owner.getByRole('heading', {name: 'Send the journey connection reply', exact: true}).waitFor();
    await move(owner, candidate, 'Journey connection reply', 'Connect journey devices');
    for (const page of pages) {
      await page.getByRole('button', {name: 'Use journey connection', exact: true}).click();
      await expect(page.getByRole('dialog', {name: 'Saved journey sharing'})).toContainText('confirmed saving this snapshot', {timeout: 15000});
      await closeSharing(page);
    }
  };
  // Each device holds a different authentic removal for an unrelated synthetic
  // subject. Connection must merge both sets before handing off journey data.
  const removalMessages = await owner.evaluate(async database => {
    const wasm = await import('../experiments/tg-pairing/hive_wasm.js'); await wasm.default();
    const store = await (await import('../experiments/tg-pairing/storage.mjs')).openBrowserStorage(database);
    let issuer;
    try {
      const group = (await store.read('candidate-persona', 'active')).value.record.group;
      issuer = await (await import('../experiments/tg-pairing/software-persona.mjs')).loadSoftwareIssuer({wasm, store, expectedGroup: group});
      const {encodeRemoval, receiveRemoval} = await import('../experiments/tg-pairing/removal-message.mjs');
      const messages = [];
      for (const sequence of [1n, 2n]) messages.push(encodeRemoval(group, await issuer.issueRevocation({subject: crypto.getRandomValues(new Uint8Array(32)), sequence, reason: 0})));
      await receiveRemoval({wasm, store, expectedGroup: group, text: messages[0]});
      return messages;
    } finally { issuer?.close(); store.close(); }
  }, namespaces.devices);
  await candidate.evaluate(async ({database, text}) => {
    const wasm = await import('../experiments/tg-pairing/hive_wasm.js'); await wasm.default();
    const store = await (await import('../experiments/tg-pairing/storage.mjs')).openBrowserStorage(database);
    try {
      const group = (await store.read('candidate-persona', 'active')).value.record.group;
      await (await import('../experiments/tg-pairing/removal-message.mjs')).receiveRemoval({wasm, store, expectedGroup: group, text});
    } finally { store.close(); }
  }, {database: namespaces.devices, text: removalMessages[1]});
  await connectJourneys();
  for (const page of pages) assert.deepEqual(await page.evaluate(async database => {
    const store = await (await import('../experiments/tg-pairing/storage.mjs')).openBrowserStorage(database);
    try {
      const group = (await store.read('candidate-persona', 'active')).value.record.group;
      const key = Array.from(group, byte => byte.toString(16).padStart(2, '0')).join('');
      return (await store.read('membership', key)).value.revocations.map(record => String(record.sequence)).sort();
    } finally { store.close(); }
  }, namespaces.devices), ['1', '2'], 'connection catches up both signed removal sets');
  await expect.poll(async () => (await saved(candidate)).length).toBe(2);
  await expect.poll(async () => (await saved(owner)).length).toBe(2);
  assert.deepEqual((await saved(candidate)).find(j => j.to.id === preferred.to.id).savedRoutes, preferred.savedRoutes);
  assert.equal((await saved(candidate)).find(j => j.to.id === preferred.to.id).count, 0, 'owner learning history stays local');
  assert.equal(await owner.locator('#current-step').textContent(), originalStep, 'receipt preserves current journey');
  // Remote changes should refresh the saved-service control without rebuilding
  // the route being followed or removing its focused action.
  await owner.locator('#prefer-services').focus();
  const currentStepNode = await owner.locator('#current-step .leg').elementHandle();
  await candidate.locator('#new-journey').click(); await reviewPlaces(candidate, '10 Victoria Road Devonport');
  await candidate.locator('#save-places').click();
  await expect(owner.locator('#prefer-services')).toHaveAttribute('aria-pressed', 'false');
  await expect(owner.locator('#prefer-services')).toBeFocused();
  assert.equal(await currentStepNode.evaluate(node => node.isConnected), true);
  assert.equal(await owner.locator('#current-step').textContent(), originalStep);
  await candidate.locator('#save-places').click();
  await candidate.locator('#journey-preferences > summary').click();
  await candidate.locator('#date').fill('2026-09-23'); await candidate.locator('#time').fill('09:00'); await candidate.locator('#find').click();
  await expect(candidate.locator('.journey-card').first()).toBeVisible({timeout: 30000});
  await candidate.locator('[data-follow]').first().click(); await candidate.locator('#prefer-services').click();
  await expect(owner.locator('#prefer-services')).toHaveAttribute('aria-pressed', 'true');
  await expect(owner.locator('#prefer-services')).toBeFocused();
  assert.equal(await currentStepNode.evaluate(node => node.isConnected), true);
  await candidate.locator('#new-journey').click(); await reviewPlaces(candidate, '1 Queen Street Auckland Central');
  await candidate.locator('#save-places').click();
  await expect(candidate.locator('#save-places')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await saved(owner)).length).toBe(1);
  assert.equal(await owner.locator('#current-step').textContent(), originalStep);
  await owner.setViewportSize({width: 320, height: 640});
  await owner.evaluate(() => document.documentElement.style.fontSize = '200%');
  await share(owner);
  assert.equal(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual((await new AxeBuilder({page: owner}).analyze()).violations.map(v => v.id), []);
  await owner.getByRole('button', {name: 'Disconnect journey sharing', exact: true}).click(); await closeSharing(owner);
  if (process.env.ROTATE_GROUP_KEYS === '1') await checkAppRotation({owner, recipient: candidate, move, atBinding: false, databaseName: namespaces.devices});
  await Promise.all(pages.map(page => expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)));
  await Promise.all(contexts.map(context => context.setOffline(true)));
  await Promise.all(pages.map(page => page.reload()));
  await owner.locator('#settings-open').click(); await owner.locator('#clear-history').click();
  await owner.getByRole('button', {name: 'Close settings', exact: true}).click();
  await savePlaces(candidate, 'University of Auckland');
  const candidateNew = (await saved(candidate)).find(j => j.to.id !== preferred.to.id);
  assert.ok(candidateNew);
  await Promise.all(contexts.map(context => context.setOffline(false)));
  await connectJourneys();
  await expect.poll(async () => (await saved(candidate)).map(j => j.to.id)).toEqual([candidateNew.to.id]);
  await expect.poll(async () => (await saved(owner)).map(j => j.to.id)).toEqual([candidateNew.to.id]);
  const shortcut = owner.locator('[data-usual]').first(); await shortcut.focus();
  const focusedShortcut = await shortcut.elementHandle();
  await candidate.locator('#save-places').click();
  await expect.poll(async () => (await saved(owner)).length).toBe(0);
  assert.equal(await focusedShortcut.evaluate(node => node.isConnected && document.activeElement === node), true, 'incoming removal preserves the focused shortcut until the user leaves it');
  await owner.locator('#destination').focus();
  await expect(owner.locator('.usual-section')).toBeHidden();
  await expect(owner.locator('#destination')).toBeFocused();
  await candidate.locator('#save-places').click();
  await expect.poll(async () => (await saved(owner)).length).toBe(1);
  await expect(owner.locator('[data-usual]').first()).toBeVisible();
  await expect(owner.locator('#destination')).toBeFocused();
  const stored = page => page.evaluate(async database => {
    const store = await (await import('../experiments/tg-pairing/storage.mjs')).openBrowserStorage(database);
    try {
      const persona = await store.read('candidate-persona', 'active');
      const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      const group = hex(persona.value.record.group);
      return {personaRevision: persona.revision, permission: await store.read('along-journey-sharing-v1', group),
        journeys: await store.read('along-saved-journeys-v1', group), at: await store.read('along-at-owners', group)};
    } finally { store.close(); }
  }, namespaces.devices);
  const beforeRemoval = await Promise.all(pages.map(stored));
  const manage = async page => {
    await page.getByRole('button', {name: 'Manage journey-sharing devices', exact: true}).click();
    await page.getByRole('button', {name: /^Device [0-9a-f]{8}…[0-9a-f]{8}$/}).click();
    await page.getByRole('button', {name: 'Stop journey sharing', exact: true}).waitFor();
  };
  await share(owner); await manage(owner);
  await owner.getByRole('button', {name: 'Back', exact: true}).click();
  assert.deepEqual((await stored(owner)).permission, beforeRemoval[1].permission, 'Back preserves permission');
  await owner.getByRole('button', {name: /^Device [0-9a-f]{8}…[0-9a-f]{8}$/}).click();
  const remove = owner.getByRole('button', {name: 'Stop journey sharing', exact: true});
  await remove.waitFor(); await remove.evaluate(button => button.click());
  assert.deepEqual((await stored(owner)).permission, beforeRemoval[1].permission, 'synthetic activation cannot remove permission');
  await owner.evaluate(() => document.documentElement.style.fontSize = '200%');
  assert.equal(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual((await new AxeBuilder({page: owner}).analyze()).violations.map(v => v.id), []);
  await remove.focus(); await owner.keyboard.press('Enter');
  await owner.getByRole('heading', {name: 'Journey-sharing permission removed', exact: true}).waitFor();
  await expect(owner.getByRole('button', {name: 'Back', exact: true})).toBeFocused();
  const removed = await stored(owner);
  assert.deepEqual(removed.permission.value.peers, []);
  assert.deepEqual(removed.journeys, beforeRemoval[1].journeys);
  assert.equal(removed.personaRevision, beforeRemoval[1].personaRevision);
  assert.equal(removed.at, null);
  assert.deepEqual((await stored(candidate)).permission, beforeRemoval[0].permission, 'permission removal is local, not a remote rewrite');
  await candidate.locator('#save-places').click();
  await expect.poll(async () => (await stored(candidate)).journeys.value.journeys.find(j => j.id.includes(candidateNew.to.id)).value).toBe(null);
  assert.deepEqual((await stored(owner)).journeys, removed.journeys, 'removed peer cannot update local journeys');
  await owner.getByRole('button', {name: 'Back', exact: true}).click();
  await expect(owner.getByRole('dialog', {name: 'Saved journey sharing'})).toContainText('No other devices have permission here');
  await owner.keyboard.press('Escape');
  await owner.getByRole('heading', {name: 'Share your saved journeys', exact: true}).waitFor(); await closeSharing(owner);
  await contexts[0].setOffline(true); await candidate.reload();
  await share(candidate); await manage(candidate);
  await candidate.getByRole('button', {name: 'Stop journey sharing', exact: true}).click();
  await candidate.getByRole('heading', {name: 'Journey-sharing permission removed', exact: true}).waitFor();
  assert.deepEqual((await stored(candidate)).permission.value.peers, [], 'permission can be removed offline after reopening');
  assert.equal((await saved(owner)).length, 1, 'stopping sharing preserves the already shared copy');
  // Group removal is a separate reviewed action, available without the peer.
  await contexts[1].setOffline(true); await owner.reload();
  const openGroupDevices = async () => {
    await owner.locator('#settings-open').click();
    await owner.getByRole('button', {name: 'Device and AT-key setup', exact: true}).click();
    await owner.getByText('Connect or recover another device', {exact: true}).click();
    await owner.getByRole('button', {name: 'Review group devices', exact: true}).click();
    await owner.getByRole('button', {name: /^Device [0-9a-f]{8}…[0-9a-f]{8}$/}).click();
  };
  await openGroupDevices();
  await owner.getByRole('button', {name: 'Save device removal here', exact: true}).waitFor();
  await owner.getByRole('button', {name: 'Back', exact: true}).click();
  await owner.getByRole('button', {name: /^Device [0-9a-f]{8}…[0-9a-f]{8}$/}).click();
  const groupRemove = owner.getByRole('button', {name: 'Save device removal here', exact: true});
  await groupRemove.focus(); await owner.keyboard.press('Enter');
  await owner.getByRole('heading', {name: 'Device removal saved here', exact: true}).waitFor();
  await owner.getByRole('status').filter({hasText: 'has not been delivered'}).waitFor();
  await expect(owner.getByRole('button', {name: 'Back', exact: true})).toBeFocused();
  assert.equal((await saved(owner)).length, 1);
  await owner.reload(); await openGroupDevices();
  await owner.getByRole('heading', {name: 'Device removal already saved here', exact: true}).waitFor();
  assert.equal(await owner.getByRole('button', {name: 'Save device removal here', exact: true}).count(), 0);
  await owner.getByRole('button', {name: 'Share this removal', exact: true}).click();
  const removalMessage = await owner.getByLabel('Device message to copy', {exact: true}).inputValue();
  await candidate.reload();
  await candidate.locator('#settings-open').click();
  await candidate.getByRole('button', {name: 'Device and AT-key setup', exact: true}).click();
  await candidate.getByRole('button', {name: 'Receive a group removal', exact: true}).click();
  await candidate.getByLabel('Signed group removal', {exact: true}).fill(removalMessage);
  await candidate.getByRole('button', {name: 'Check and save removal', exact: true}).click();
  await candidate.getByRole('heading', {name: 'Group removal saved', exact: true}).waitFor();
  await candidate.getByRole('status').filter({hasText: 'This device is removed from the group'}).waitFor();
  await candidate.reload();
  await candidate.locator('#settings-open').click();
  await expect(candidate.getByRole('button', {name: 'Share saved journeys with my devices', exact: true})).toHaveCount(0);
  assert.equal((await saved(owner)).length, 1);
  if (process.env.CAPACITY === '1') {
    await owner.reload();
    const beforeCapacity = await stored(owner);
    const queued = await owner.evaluate(async () => {
      const {readPreferences, writePreferences, readEnvelope} = await import('../experiments/journey-sync/app-preferences.mjs');
      const data = readPreferences(), sample = data.journeys.find(j => j.saved);
      // Boundary fixture uses the production save/journal path; no deletion markers are removed.
      data.journeys = Array.from({length: 257}, (_, n) => ({...sample,
        to: {...sample.to, id: 'capacity-' + n, name: 'Capacity example ' + n}}));
      if (!writePreferences(data)) throw Error('Local save was blocked by sharing capacity');
      return readEnvelope().raw;
    });
    await owner.reload(); await share(owner);
    const full = owner.getByRole('status').filter({hasText: 'Sharing has reached its 256-place limit'});
    await full.waitFor();
    await expect(full).toContainText('Reconnecting or deleting places will not free sharing space');
    await owner.getByRole('button', {name: 'Start journey connection', exact: true}).click();
    await expect(full).toContainText('Your saved places and queued changes remain here');
    assert.equal((await preferences(owner)).journeys.length, 257);
    assert.equal(await owner.evaluate(key => localStorage.getItem(key), namespaces.preferences), queued);
    const afterCapacity = await stored(owner);
    assert.deepEqual(afterCapacity.journeys, beforeCapacity.journeys, 'oversized import never partly replaces replicated state');
    assert.equal(afterCapacity.personaRevision, beforeCapacity.personaRevision);
    assert.deepEqual((await new AxeBuilder({page: owner}).analyze()).violations.map(v => v.id), []);
    await closeSharing(owner);
    console.log('PASS: capacity refusal remains specific after reload/retry, preserves all 257 local saves and exact queued changes, and leaves replicated state and identity unchanged.');
  }
  assert.equal(providerRequests.length, 0); assert.deepEqual(errors, []);
  console.log('PASS: actual Settings enrollment/connection, saved places and service preferences, local history, current-step preservation, focused shortcut preservation and deferred refresh, service-control refresh without route replacement, narrow/zoom accessibility, offline edits and convergence; permission review/removal, retained copies, issued-device selection and offline group removal/reload. Two browser profiles on one host; manual transfer, not physical reachability or automatic discovery.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
