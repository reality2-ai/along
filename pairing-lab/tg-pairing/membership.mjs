// Public membership evidence only. No group secrets or application credentials.
// Trusted enrollment/rotation transport must establish group and epoch policy.
const fixed = (v, n) => v instanceof Uint8Array && v.length === n;
const u64 = v => typeof v === 'bigint' && v >= 0n && v <= 0xffffffffffffffffn;
const hex = value => Array.from(value, b => b.toString(16).padStart(2, '0')).join('');
const same = (a, b) => fixed(a, b.length) && a.every((v, i) => v === b[i]);
const validRevocation = r => r && fixed(r.subject, 32) && u64(r.epoch) && u64(r.sequence)
  && Number.isInteger(r.reason) && r.reason >= 0 && r.reason <= 3 && fixed(r.signature, 64);
const refuse = () => new Error('Membership evidence unavailable');

function restore(wasm, record, expectedGroup, expectedSubject) {
  const value = record?.value;
  if (!value || value.format !== 1 || !same(value.group, expectedGroup) || !same(value.subject, expectedSubject)
      || !u64(value.current) || !u64(value.depth) || !fixed(value.certificate, 136)
      || !Array.isArray(value.revocations) || value.revocations.length > 256) throw refuse();
  const state = wasm.BrowserMembership.establish(value.group, value.current, value.depth);
  try {
    for (const r of value.revocations) {
      if (!validRevocation(r) || !state.apply_revocation(r.subject, r.epoch, r.sequence, r.reason, r.signature)) throw refuse();
    }
    const status = state.status(value.certificate, value.subject);
    if (status === 'invalid') throw refuse();
    return {state, value, status};
  } catch (e) { state.free(); throw e; }
}

// Explicit bootstrap from an already established group, never automatic adoption
// of whatever group/epoch an incoming certificate names. Enrollment UI/transport
// is a separate boundary which must supply these trusted inputs.
export async function establishMembership(store, wasm, inputs) {
  const {group, subject, current, depth, certificate} = inputs;
  const value = structuredClone({group, subject, current, depth, certificate, format: 1, revocations: []});
  if (!fixed(value.group, 32) || !fixed(value.subject, 32)) throw refuse();
  const checked = restore(wasm, {value}, value.group, value.subject);
  const status = checked.status; checked.state.free();
  if (status !== 'current') throw refuse();
  const result = await store.compareAndSwap('membership', hex(value.group), 0, value);
  if (!result.applied) throw new Error('Membership already established');
  return openMembership(store, wasm, value.group, value.subject);
}

export function openMembership(store, wasm, expectedGroup, expectedSubject) {
  if (!fixed(expectedGroup, 32) || !fixed(expectedSubject, 32)) throw refuse();
  const group = expectedGroup.slice(), subject = expectedSubject.slice(), key = hex(group);
  let uncertain = false, closed = false, pending = 0;
  const listeners = new Set();
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('r2-membership:' + key) : null;
  const invalidate = () => { for (const listener of listeners) { try { listener(); } catch {} } };
  const read = async () => {
    const record = await store.read('membership', key);
    if (!record) throw refuse();
    return {record, ...restore(wasm, record, group, subject)};
  };
  const applyRevocation = async (input, relay) => {
    if (closed) throw refuse();
    const r = structuredClone(input);
    if (!validRevocation(r)) throw refuse();
    let announced = false;
    try {
    for (let attempt = 0; attempt < 8; attempt++) {
      const {record, state, value} = await read();
      let valid;
      try { valid = state.apply_revocation(r.subject, r.epoch, r.sequence, r.reason, r.signature); }
      finally { state.free(); }
      if (closed) throw refuse();
      if (!valid) throw refuse();
      // Invalidate consumers and inform other tabs only AFTER authentication,
      // but before waiting on storage. Each receiver verifies the signature too.
      if (!announced) {
        announced = true; pending++; invalidate();
        if (relay && channel && !closed) channel.postMessage(r);
      }
      // Authentication occurs before deduplication, even for revoked subjects.
      if (value.revocations.some(old => same(old.subject, r.subject))) return;
      value.revocations.push(r);
      try {
        const result = await store.compareAndSwap('membership', key, record.revision, value);
        if (result.applied) { invalidate(); return; }
      } catch (e) { uncertain = true; invalidate(); throw e; }
    }
    uncertain = true; invalidate();
    throw new Error('Membership changed concurrently; reopen after verification');
    } finally { if (announced) { pending--; invalidate(); } }
  };
  if (channel) channel.onmessage = event => { void applyRevocation(event.data, false).catch(() => {}); };
  return Object.freeze({
    // Informational standing against locally held state, NOT a credential grant.
    // Fresh peer verification after startup/partition remains mandatory upstream.
    status: async () => {
      if (uncertain || closed || pending) return 'unavailable';
      const snapshot = await read();
      snapshot.state.free(); return uncertain || closed || pending ? 'unavailable' : snapshot.status;
    },
    // A checked public snapshot for binding a handshake to THIS local persona.
    // It is not a reusable grant: every protected operation needs fresh checks.
    sessionContext: async () => {
      if (uncertain || closed || pending) throw refuse();
      const snapshot = await read();
      snapshot.state.free();
      const latest = await store.read('membership', key);
      if (snapshot.status !== 'current' || uncertain || closed || pending
          || latest?.revision !== snapshot.record.revision) throw refuse();
      return {group: group.slice(), subject: subject.slice(), epoch: snapshot.value.current};
    },
    peerStatus: async (certificate, peer) => {
      if (!fixed(certificate, 136) || !fixed(peer, 32) || uncertain || closed || pending) return 'unavailable';
      const cert = certificate.slice(), subject = peer.slice();
      const snapshot = await read();
      let status;
      try { status = snapshot.status === 'current' ? snapshot.state.status(cert, subject) : 'unavailable'; }
      finally { snapshot.state.free(); }
      const latest = await store.read('membership', key);
      return uncertain || closed || pending || latest?.revision !== snapshot.record.revision ? 'unavailable' : status;
    },
    applyRevocation: input => applyRevocation(input, true),
    verifyPeerEvidence: async (certificate, peer, statement, nonce, signature) => {
      if (!fixed(certificate, 136) || !fixed(peer, 32) || !(statement instanceof Uint8Array)
          || statement.length > 512 || !fixed(nonce, 16) || !fixed(signature, 64)) return false;
      const inputs = [certificate, peer, statement, nonce, signature].map(bytes => bytes.slice());
      if (uncertain || closed || pending) return false;
      const snapshot = await read();
      let verified;
      try { verified = snapshot.status === 'current' && snapshot.state.verify_nonce(...inputs); }
      finally { snapshot.state.free(); }
      const latest = await store.read('membership', key);
      return verified && !uncertain && !closed && !pending && latest?.revision === snapshot.record.revision;
    },
    authoriseInvitationEvidence: async (statement, certificate, nonce, signature) => {
      if (!fixed(statement, 89) || !fixed(certificate, 136) || !fixed(nonce, 16) || !fixed(signature, 64)) return null;
      const inputs = [statement, certificate, nonce, signature].map(bytes => bytes.slice());
      if (uncertain || closed || pending) return null;
      const snapshot = await read();
      let invitation = null;
      try {
        if (snapshot.status === 'current') invitation = snapshot.state.authorise_invitation(...inputs) ?? null;
      } finally { snapshot.state.free(); }
      if (!invitation) return null;
      try {
        const latest = await store.read('membership', key);
        if (!uncertain && !closed && !pending && latest?.revision === snapshot.record.revision) {
          const result = invitation; invitation = null; return result;
        }
        return null;
      } finally { invitation?.free(); }
    },
    // Consumers use this to cancel pending work and discard cached grants. It is
    // only invalidation, never a notification authorizing access.
    subscribe: listener => {
      if (typeof listener !== 'function' || closed) throw refuse();
      listeners.add(listener); return () => listeners.delete(listener);
    },
    close: () => { closed = true; channel?.close(); invalidate(); listeners.clear(); },
  });
}
