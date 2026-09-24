import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import('@playwright/test');
const sources = new Map();
for (const name of ['storage.mjs', 'membership.mjs', 'certificate.mjs']) sources.set('/' + name, await readFile(join(process.env.R2_BROWSER_DIR, name)));
for (const name of ['software-persona.mjs', 'local-persona.mjs', 'epoch-preparation.mjs', 'epoch-recovery-material.mjs', 'epoch-transition.mjs', 'epoch-installation.mjs', 'epoch-watch.mjs', 'software-traffic.mjs', 'member-removal.mjs']) sources.set('/' + name, await readFile(new URL(name, import.meta.url)));
for (const name of ['hive_wasm.js', 'hive_wasm_bg.wasm']) sources.set('/' + name, await readFile(join(process.env.R2_WASM_DIR, name)));
for (const name of ['state.mjs', 'generation-state.mjs', 'generation-checkpoint.mjs', 'checkpoint-preparation.mjs', 'generation-migration.mjs'])
  sources.set('/journey-sync/' + name, await readFile(new URL('../journey-sync/' + name, import.meta.url)));
// The journey migration imports the actual persona from its normal relative path.
for (const name of ['local-persona.mjs', 'membership.mjs', 'certificate.mjs']) sources.set('/tg-pairing/' + name, sources.get('/' + name));
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url.endsWith('.wasm') ? 'application/wasm' : sources.has(req.url) ? 'text/javascript' : 'text/html');
  res.end(sources.get(req.url) || '<!doctype html><title>Epoch preparation test</title>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const context = await browser.newContext(), page = await context.newPage();
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url);
  const first = await page.evaluate(async () => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const {openBrowserStorage} = await import('./storage.mjs');
    const {initializeSoftwarePersona, loadSoftwareIssuer} = await import('./software-persona.mjs');
    const store = await openBrowserStorage('epoch-preparation');
    const setup = await initializeSoftwarePersona({wasm, store});
    const group = Uint8Array.from(setup.group.match(/../g), b => parseInt(b, 16));
    const issuer = await loadSoftwareIssuer({wasm, store, expectedGroup: group});
    const before = await store.read('candidate-persona', 'active');
    const {emptyState, changeJourney} = await import('./journey-sync/state.mjs');
    const journeyState = changeJourney(emptyState(setup.group), setup.member,
      JSON.stringify(['stop', 'from', 'stop', 'gone']), null);
    await store.compareAndSwap('along-saved-journeys-v1', setup.group, 0, journeyState);
    const {migrateJourneyGeneration} = await import('./journey-sync/generation-migration.mjs');
    await migrateJourneyGeneration({wasm, store, expectedGroup: group, expectedRevision: 1});
    const checkpoints = await Promise.all([issuer.prepareJourneyCheckpoint({expectedRevision: 1}), issuer.prepareJourneyCheckpoint({expectedRevision: 1})]);
    if (JSON.stringify(checkpoints[0]) !== JSON.stringify(checkpoints[1])) throw Error('checkpoint preparation forked');
    if ((await store.read('along-prepared-journey-checkpoint-v1', setup.group + ':1')).revision !== 1) throw Error('checkpoint rewritten');
    const results = await Promise.all([issuer.prepareRotation(), issuer.prepareRotation()]);
    const saved = await store.read('along-prepared-epoch-v1', setup.group + ':1');
    const after = await store.read('candidate-persona', 'active');
    const membership = await store.read('membership', setup.group);
    const outcome = {group: setup.group, checkpoint: Array.from(checkpoints[0].checkpoint), transitions: results.map(r => Array.from(r.transition)),
      revision: saved.revision, unchangedPersona: before.revision === after.revision,
      currentEpoch: String(membership.value.current), encrypted: saved.value.ciphertext.length === 80
        && saved.value.wrappingKey.extractable === false && !('payloadKey' in saved.value),
      delivered: results.some(r => r.delivered)};
    issuer.close(); store.close(); return outcome;
  });
  assert.deepEqual(first.transitions[0], first.transitions[1]);
  assert.equal(first.revision, 1); assert.equal(first.unchangedPersona, true);
  assert.equal(first.currentEpoch, '0'); assert.equal(first.encrypted, true); assert.equal(first.delivered, false);
  await page.close();
  const restored = await context.newPage(); await restored.goto(url);
  assert.equal(await restored.evaluate(async first => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const {openBrowserStorage} = await import('./storage.mjs');
    const {initializeSoftwarePersona, loadSoftwareIssuer} = await import('./software-persona.mjs');
    const store = await openBrowserStorage('epoch-preparation');
    const group = Uint8Array.from(first.group.match(/../g), b => parseInt(b, 16));
    const issuer = await loadSoftwareIssuer({wasm, store, expectedGroup: group});
    const check = (v, text) => { if (!v) throw Error(text); };
    const denied = fn => fn().then(() => false, () => true);
    const restoredCheckpoint = await issuer.prepareJourneyCheckpoint({expectedRevision: 1});
    check(JSON.stringify(Array.from(restoredCheckpoint.checkpoint)) === JSON.stringify(first.checkpoint), 'real issuer restores checkpoint');
    check(await denied(() => issuer.prepareJourneyCheckpoint({expectedRevision: 2})), 'stale review revision refuses');
    const result = await issuer.prepareRotation();
    check(JSON.stringify(Array.from(result.transition)) === JSON.stringify(first.transitions[0]), 'fresh document reuses preparation');
    const scope = 'along-prepared-epoch-v1', key = first.group + ':1';
    const original = await store.read(scope, key);
    check(original.revision === 1, 'retry does not rewrite');
    for (const field of ['ciphertext', 'transition', 'certificate']) {
      const held = await store.read(scope, key), changed = structuredClone(original.value);
      changed[field][0] ^= 1;
      await store.compareAndSwap(scope, key, held.revision, changed);
      const corrupt = await store.read(scope, key);
      check(await denied(() => issuer.prepareRotation()), 'corrupt ' + field + ' refuses');
      check((await store.read(scope, key)).revision === corrupt.revision, 'corruption not silently replaced');
      await store.compareAndSwap(scope, key, corrupt.revision, original.value);
    }
    const subject = crypto.getRandomValues(new Uint8Array(32));
    const oldMaterial = await issuer.enrollmentMaterial(subject);
    const oldCertificate = oldMaterial.certificate.slice();
    const oldDigest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', oldMaterial.payloadKey)));
    oldMaterial.destroy();
    const {installPreparedIssuerEpoch} = await import('./epoch-installation.mjs');
    const install = epoch => installPreparedIssuerEpoch({wasm, store, expectedGroup: group, epoch});
    const rejected = {...store, compareAndSwapMany: async () => { throw Error('write failed'); }};
    check(await denied(() => installPreparedIssuerEpoch({wasm, store: rejected, expectedGroup: group, epoch: 1n})), 'failed owner install');
    check((await store.read('candidate-persona', 'active')).value.epoch === 0n, 'failed owner install preserves epoch');
    const put = IDBObjectStore.prototype.put;
    let interruptedInstall = false;
    IDBObjectStore.prototype.put = function(...args) {
      const result = put.apply(this, args);
      if (args[1]?.[0] === 'along-browser-traffic') { interruptedInstall = true; this.transaction.abort(); }
      return result;
    };
    try { check(await denied(() => install(1n)), 'interrupted owner install refuses'); }
    finally { IDBObjectStore.prototype.put = put; }
    check(interruptedInstall && (await store.read('candidate-persona', 'active')).value.epoch === 0n
      && (await store.read('membership', first.group)).value.current === 0n
      && await store.read('along-browser-traffic', first.group) === null
      && await store.read('along-installed-epoch-v1', first.group + ':1') === null, 'all owner writes roll back');
    check((await install(1n)).epoch === 1n, 'issuer advances');
    check((await install(1n)).alreadyInstalled, 'explicit target retry does not advance twice');
    check(await denied(() => issuer.issueCertificate(subject)), 'old issuer handle refuses');
    check(await denied(() => issuer.prepareJourneyCheckpoint({expectedRevision: 1})), 'old epoch issuer cannot prepare checkpoint');
    issuer.close();
    let renewed = await loadSoftwareIssuer({wasm, store, expectedGroup: group});
    check(JSON.stringify(Array.from((await renewed.prepareJourneyCheckpoint({expectedRevision: 1})).checkpoint)) === JSON.stringify(first.checkpoint), 'new key epoch reuses existing journey checkpoint');
    const next = await renewed.enrollmentMaterial(subject);
    try {
      check(next.epoch === 1n && new DataView(next.certificate.buffer).getBigUint64(64) === 1n, 'renewed enrollment epoch');
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', next.payloadKey)));
      check(JSON.stringify(digest) !== JSON.stringify(oldDigest), 'old traffic key not reused');
      const currentTraffic = await (await import('./software-traffic.mjs')).loadSoftwareTraffic({wasm, store, expectedGroup: group});
      try { check(next.payloadKey.every((b, i) => b === currentTraffic.payloadKey[i]), 'enrollment uses installed traffic keys'); }
      finally { currentTraffic.destroy(); }
    } finally { next.destroy(); }
    const second = await renewed.prepareRotation();
    check(second.from === 1n && second.to === 2n, 'second successor supported');
    await install(2n); renewed.close();
    renewed = await loadSoftwareIssuer({wasm, store, expectedGroup: group});
    const recovered = [];
    for (const epoch of [1n, 2n]) {
      const material = await renewed.recoveryMaterial({subject, certificate: oldCertificate, epoch});
      try {
        check(material.epoch === epoch && new DataView(material.certificate.buffer).getBigUint64(64) === epoch, 'ordered historical material available');
        recovered.push(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', material.payloadKey))));
      } finally { material.destroy(); check(material.payloadKey.every(b => b === 0) && material.integrityKey.every(b => b === 0), 'volatile recovery keys cleared'); }
    }
    check(JSON.stringify(recovered[0]) !== JSON.stringify(recovered[1]), 'historical epochs retain distinct keys');
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    let removal, exposedBuffer;
    crypto.subtle.decrypt = async (...args) => {
      const result = await decrypt(...args);
      if (!exposedBuffer && new TextDecoder().decode(args[0].additionalData).includes('along/prepared-epoch/v1')) {
        exposedBuffer = result;
        removal = await (await import('./member-removal.mjs')).removeSoftwareMember({wasm, store, expectedGroup: group, subject, certificate: oldCertificate});
      }
      return result;
    };
    try { check(await denied(() => renewed.recoveryMaterial({subject, certificate: oldCertificate, epoch: 2n})), 'removal during decryption blocks recovery'); }
    finally { crypto.subtle.decrypt = decrypt; }
    check(exposedBuffer && new Uint8Array(exposedBuffer).every(b => b === 0), 'failed recovery clears actual decrypted buffer');
    check(removal.evidence.epoch === 2n, 'stale authentic device can be removed at current epoch');
    check(await denied(() => renewed.enrollmentMaterial(subject)), 'removed member cannot get new epoch keys');
    renewed.close();
    check(await denied(() => renewed.prepareJourneyCheckpoint({expectedRevision: 1})), 'closed issuer cannot prepare checkpoint');
    check((await store.read('along-saved-journeys-v2', first.group)).revision === 1, 'preparation never installs journey generation');
    store.close();
    // A failed commit must neither advance membership nor leave half a record.
    const other = await openBrowserStorage('epoch-preparation-failure');
    const created = await initializeSoftwarePersona({wasm, store: other});
    const otherGroup = Uint8Array.from(created.group.match(/../g), b => parseInt(b, 16));
    const failing = {...other, compareAndSwapMany: async () => { throw Error('simulated storage failure'); }};
    const failedIssuer = await loadSoftwareIssuer({wasm, store: failing, expectedGroup: otherGroup});
    check(await denied(() => failedIssuer.prepareRotation()), 'failed commit refuses');
    check(await other.read(scope, created.group + ':1') === null, 'no partial preparation');
    check((await other.read('membership', created.group)).value.current === 0n, 'no advance');
    failedIssuer.close();
    const abort = new AbortController();
    const cancelled = await loadSoftwareIssuer({wasm, store: other, expectedGroup: otherGroup, signal: abort.signal});
    abort.abort();
    check(await denied(() => cancelled.prepareRotation()), 'early cancellation refuses');
    check(await other.read(scope, created.group + ':1') === null, 'cancel before commit writes nothing');
    cancelled.close();
    const raced = {...other, compareAndSwapMany: async (writes, options) => {
      const bootstrap = await other.read('persona-bootstrap', 'initial');
      await other.compareAndSwap('persona-bootstrap', 'initial', bootstrap.revision, bootstrap.value);
      return other.compareAndSwapMany(writes, options);
    }};
    const raceIssuer = await loadSoftwareIssuer({wasm, store: raced, expectedGroup: otherGroup});
    check(await denied(() => raceIssuer.prepareRotation()), 'changed custody refuses at commit');
    check(await other.read(scope, created.group + ':1') === null, 'revision guard prevents stale preparation');
    raceIssuer.close();
    const late = new AbortController();
    const lateStore = {...other, compareAndSwapMany: async (writes, options) => {
      const result = await other.compareAndSwapMany(writes, options);
      if (result.applied) late.abort();
      return result;
    }};
    const lateIssuer = await loadSoftwareIssuer({wasm, store: lateStore, expectedGroup: otherGroup, signal: late.signal});
    check(await denied(() => lateIssuer.prepareRotation()), 'late cancellation refuses handoff');
    const committed = await other.read(scope, created.group + ':1');
    check(committed?.revision === 1, 'late cancellation cannot undo saved preparation');
    lateIssuer.close();
    const resumed = await loadSoftwareIssuer({wasm, store: other, expectedGroup: otherGroup});
    check((await resumed.prepareRotation()).status === 'prepared-locally', 'retry recovers late commit');
    check((await other.read(scope, created.group + ':1')).revision === 1, 'late commit retry does not replace keys');
    resumed.close();
    const {initialGeneration} = await import('./journey-sync/generation-state.mjs');
    const {emptyState} = await import('./journey-sync/state.mjs');
    await other.compareAndSwap('along-saved-journeys-v2', created.group, 0, initialGeneration(emptyState(created.group)));
    const permissionRace = {...other, compareAndSwapMany: async (writes, options) => {
      if (writes.some(write => write.scope === 'along-prepared-journey-checkpoint-v1'))
        await other.compareAndSwap('along-journey-sharing-v1', created.group, 0, {format: 1, member: created.member, peers: []});
      return other.compareAndSwapMany(writes, options);
    }};
    const guardedIssuer = await loadSoftwareIssuer({wasm, store: permissionRace, expectedGroup: otherGroup});
    check(await denied(() => guardedIssuer.prepareJourneyCheckpoint({expectedRevision: 1})), 'permission change during preparation refuses');
    check(await other.read('along-prepared-journey-checkpoint-v1', created.group + ':1') === null, 'no stale permission preparation');
    guardedIssuer.close();
    const stopCheckpoint = new AbortController();
    const stoppedIssuer = await loadSoftwareIssuer({wasm, store: other, expectedGroup: otherGroup, signal: stopCheckpoint.signal});
    stopCheckpoint.abort();
    check(await denied(() => stoppedIssuer.prepareJourneyCheckpoint({expectedRevision: 1})), 'cancelled real issuer refuses checkpoint');
    stoppedIssuer.close(); other.close(); return true;
  }, first), true);
  await restored.close();
  const advanced = await context.newPage(); await advanced.goto(url);
  assert.equal(await advanced.evaluate(async groupHex => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const store = await (await import('./storage.mjs')).openBrowserStorage('epoch-preparation');
    const group = Uint8Array.from(groupHex.match(/../g), b => parseInt(b, 16));
    let issuer, material;
    try {
      issuer = await (await import('./software-persona.mjs')).loadSoftwareIssuer({wasm, store, expectedGroup: group});
      material = await issuer.enrollmentMaterial(crypto.getRandomValues(new Uint8Array(32)));
      return material.epoch === 2n && (await store.read('membership', groupHex)).value.revocations.length === 1;
    } finally { material?.destroy(); issuer?.close(); store.close(); }
  }, first.group), true);
  console.log('PASS: concurrent encrypted epoch preparation, atomic advancement, reload and removal checks; real software issuer prepares/restores one journey checkpoint, retains it across key rotation, and refuses stale review, old/closed/cancelled handles and a permission change during commit. Journey generation installation and recovery UI remain separate.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
