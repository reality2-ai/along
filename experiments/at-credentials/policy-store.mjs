// Durable acceptance of public Along policy only. No credential bytes are kept
// here; owner establishment and current TG authorization remain caller duties.
import {verifyCredentialPolicy} from './policy.mjs';
const fail = () => new Error('Stored credential policy unavailable');
export function openCredentialPolicyStore({store, group, owner, credential}) {
  if (![group, owner].every(v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v))
      || typeof credential !== 'string' || !/^[0-9a-f]{32}$/.test(credential)) throw fail();
  const binding = Object.freeze({group, owner, credential});
  const scope = 'along-at-policy:' + owner, key = group + ':' + credential;
  const current = signal => { if (signal?.aborted) throw fail(); };
  const load = async signal => {
    current(signal);
    const saved = await store.read(scope, key); current(signal);
    if (saved === null) return null;
    if (saved?.value?.format !== 1 || !Number.isSafeInteger(saved.revision) || saved.revision < 1) throw fail();
    const policy = await verifyCredentialPolicy(saved.value.bytes, saved.value.signature,
      {...binding, afterRevision: 0n, minimumGeneration: 1n});
    current(signal);
    const latest = await store.read(scope, key); current(signal);
    if (latest?.revision !== saved.revision) throw fail();
    return {policy, storageRevision: saved.revision};
  };
  const accept = async (bytes, signature, first, signal) => {
    if (!(bytes instanceof Uint8Array) || bytes.length > 2048 || !(signature instanceof Uint8Array) || signature.length !== 64) throw fail();
    const snapshot = bytes.slice(), proof = signature.slice();
    const saved = await load(signal);
    if (first ? saved !== null : saved === null) throw fail();
    const policy = await verifyCredentialPolicy(snapshot, proof, {...binding,
      afterRevision: saved?.policy.revision ?? 0n, minimumGeneration: saved?.policy.generation ?? 1n});
    current(signal);
    const result = await store.compareAndSwapMany([{scope, key, expectedRevision: saved?.storageRevision ?? 0,
      value: {format: 1, bytes: snapshot, signature: proof}}], {signal});
    if (!result.applied) throw fail();
    // Report the actual committed revision even if cancellation arrives with
    // completion. This is a saved-policy receipt, not current access authority.
    return Object.freeze({status: 'policy-saved', policy, storageRevision: result.revisions[0]});
  };
  return Object.freeze({
    read: async ({signal} = {}) => {
      const saved = await load(signal);
      return saved ? Object.freeze({status: 'policy-loaded', ...saved}) : Object.freeze({status: 'unconfigured'});
    },
    // Explicit local/confirmed owner-establishment path only. A network update
    // cannot fall back to this operation when no local policy exists.
    establish: (bytes, signature, {signal} = {}) => accept(bytes, signature, true, signal),
    update: (bytes, signature, {signal} = {}) => accept(bytes, signature, false, signal),
  });
}
