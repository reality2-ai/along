// Browser test helper; uses a real enrolled recipient and a synthetic issuer.
import {installRecipientEpoch} from './epoch-installation.mjs';
import {loadLocalPersona} from './local-persona.mjs';
import {loadSoftwareTraffic} from './software-traffic.mjs';
export async function checkEpochInstall(wasm, store, raw) {
  const bundle = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, new Uint8Array(v)]));
  const options = {wasm, store, ...bundle};
  const check = (v, why) => { if (!v) throw Error(why); };
  const denied = fn => fn().then(() => false, () => true);
  const hex = v => Array.from(v, b => b.toString(16).padStart(2, '0')).join('');
  const key = hex(bundle.expectedGroup), scope = 'along-installed-epoch-v1';
  const before = await store.read('candidate-persona', 'active');
  const standingBefore = await store.read('membership', key);
  const retained = {...standingBefore.value, revocations: [...standingBefore.value.revocations,
    {subject: bundle.removedSubject, epoch: 0n, sequence: 1n, reason: 0, signature: bundle.removedSignature}]};
  await store.compareAndSwap('membership', key, standingBefore.revision, retained);
  for (const name of ['expectedGroup', 'transition', 'certificate', 'payloadKey', 'integrityKey']) {
    const altered = structuredClone(bundle); altered[name][0] ^= 1;
    check(await denied(() => installRecipientEpoch({...options, ...altered})), 'substituted ' + name);
    check((await store.read('candidate-persona', 'active')).revision === before.revision, 'refusal has no persona write');
  }
  const abort = new AbortController(); abort.abort();
  check(await denied(() => installRecipientEpoch({...options, signal: abort.signal})), 'early cancellation');
  const original = IDBObjectStore.prototype.put;
  let interrupted = false;
  IDBObjectStore.prototype.put = function(...args) {
    const result = original.apply(this, args);
    if (args[1]?.[0] === 'along-browser-traffic') { interrupted = true; this.transaction.abort(); }
    return result;
  };
  try { check(await denied(() => installRecipientEpoch(options)), 'interrupted transaction refuses'); }
  finally { IDBObjectStore.prototype.put = original; }
  check(interrupted && (await store.read('candidate-persona', 'active')).revision === before.revision, 'persona rolled back');
  check((await store.read('membership', key)).value.current === 0n, 'membership rolled back');
  check((await store.read('along-browser-traffic', key)).value.epoch === 0n, 'traffic rolled back');
  check(await store.read(scope, key + ':1') === null, 'no orphan receipt');
  const raced = {...store, compareAndSwapMany: async (writes, opts) => {
    const standing = await store.read('membership', key);
    await store.compareAndSwap('membership', key, standing.revision, {...standing.value,
      revocations: [...standing.value.revocations, {subject: before.value.record.subject, epoch: 0n,
        sequence: 2n, reason: 0, signature: bundle.selfRemovalSignature}]});
    return store.compareAndSwapMany(writes, opts);
  }};
  check(await denied(() => installRecipientEpoch({...options, store: raced})), 'concurrent membership revision refuses');
  check((await store.read('candidate-persona', 'active')).revision === before.revision, 'race leaves persona unchanged');
  check(await denied(() => installRecipientEpoch(options)), 'removed recipient cannot retry into new epoch');
  // Restore only this synthetic test fixture to exercise the successful branch.
  // Production has no operation to undo a signed terminal removal.
  const removed = await store.read('membership', key);
  await store.compareAndSwap('membership', key, removed.revision, retained);
  const old = await loadLocalPersona({wasm, store, expectedGroup: bundle.expectedGroup});
  const late = new AbortController();
  const lateStore = {...store, compareAndSwapMany: async (writes, opts) => {
    const result = await store.compareAndSwapMany(writes, opts);
    if (result.applied) late.abort(); return result;
  }};
  const installed = await installRecipientEpoch({...options, store: lateStore, signal: late.signal});
  check(installed.status === 'installed-local' && !installed.alreadyInstalled && late.signal.aborted, 'late cancellation reports commit');
  check(await denied(() => old.sign(new Uint8Array(32))), 'old persona handle cannot sign');
  const replay = await installRecipientEpoch(options);
  check(replay.alreadyInstalled && replay.epoch === 1n, 'matching replay recovers receipt');
  check((await store.read('candidate-persona', 'active')).revision === before.revision + 1, 'replay does not rewrite persona');
  const advanced = await store.read('membership', key);
  check(advanced.value.revocations.length === 1
    && hex(advanced.value.revocations[0].subject) === hex(bundle.removedSubject), 'earlier signed removal survives advancement');
  const local = await loadLocalPersona({wasm, store, expectedGroup: bundle.expectedGroup});
  const traffic = await loadSoftwareTraffic({wasm, store, expectedGroup: bundle.expectedGroup});
  try {
    check(local.epoch === 1n && traffic.epoch === 1n, 'all state advances');
    check(local.member === hex(before.value.record.subject), 'member identity unchanged');
    check(traffic.payloadKey.every((b, i) => b === bundle.payloadKey[i])
      && traffic.integrityKey.every((b, i) => b === bundle.integrityKey[i]), 'new keys restored');
    check((await local.sign(new Uint8Array(32))).length === 64, 'new persona can sign');
  } finally { traffic.destroy(); }
  return true;
}
