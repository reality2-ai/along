import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {openMembership} from '../tg-pairing/membership.mjs';
import {openJourneyStore} from './store.mjs';
import {validateState} from './state.mjs';
const scope = 'along-journey-sharing-v1';
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const fail = () => new Error('Journey sharing unavailable');
const context = (group, peer) => {
  if (!(group instanceof Uint8Array) || group.length !== 32 || !(peer instanceof Uint8Array) || peer.length !== 32) throw fail();
  return {group: group.slice(), peer: peer.slice(), key: hex(group), remote: hex(peer)};
};
function permission(record, member) {
  if (record === null) return [];
  const value = record?.value;
  if (!value || Object.keys(value).sort().join(',') !== 'format,member,peers' || value.format !== 1
      || value.member !== member || !Array.isArray(value.peers) || value.peers.length > 16
      || value.peers.some(peer => typeof peer !== 'string' || !/^[0-9a-f]{64}$/.test(peer) || peer === member)
      || new Set(value.peers).size !== value.peers.length) throw fail();
  return value.peers.slice();
}

// Call only from a deliberate local permission review. Enrollment alone does not
// invoke this operation. A proof of current membership is required for new access.
export async function setJourneyPermission({wasm, store, expectedGroup, peer, certificate, allow, expectedRevision, signal}) {
  const ctx = context(expectedGroup, peer);
  if (store.capabilities?.transactionChecks !== true || typeof allow !== 'boolean' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw fail();
  const proof = certificate?.slice();
  const persona = await store.read('candidate-persona', 'active');
  const membership = await store.read('membership', ctx.key);
  const identity = await loadLocalPersona({wasm, store, expectedGroup: ctx.group});
  if (!identity || !persona || !membership || identity.member === ctx.remote) throw fail();
  const saved = await store.read(scope, ctx.key);
  const peers = permission(saved, identity.member);
  if ((saved?.revision ?? 0) !== expectedRevision) throw fail();
  if (allow) {
    const held = openMembership(store, wasm, ctx.group, persona.value.record.subject);
    try { if (await held.peerStatus(proof, ctx.peer) !== 'current') throw fail(); } finally { held.close(); }
  }
  const next = allow ? [...new Set([...peers, ctx.remote])].sort() : peers.filter(peer => peer !== ctx.remote);
  if (next.length > 16) throw fail();
  const result = await store.compareAndSwapMany([{scope, key: ctx.key, expectedRevision,
    value: {format: 1, member: identity.member, peers: next}}], {signal, checks: [
    {scope: 'candidate-persona', key: 'active', expectedRevision: persona.revision},
    {scope: 'membership', key: ctx.key, expectedRevision: membership.revision},
  ]});
  if (!result.applied) throw fail();
  return {status: 'journey-permission-saved', revision: result.revisions[0]};
}

export async function readJourneyPermission({wasm, store, expectedGroup}) {
  if (!(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32) throw fail();
  const group = expectedGroup.slice();
  const identity = await loadLocalPersona({wasm, store, expectedGroup: group});
  if (!identity) throw fail();
  const record = await store.read(scope, hex(group));
  return {member: identity.member, revision: record?.revision ?? 0, peers: permission(record, identity.member)};
}

// The session layer must independently authenticate the selected peer. This
// adapter enforces local application consent; it is not a network authenticator.
export async function openPermittedJourneys({wasm, store, expectedGroup, peer}) {
  const ctx = context(expectedGroup, peer);
  if (store.capabilities?.transactionChecks !== true) throw fail();
  const identity = await loadLocalPersona({wasm, store, expectedGroup: ctx.group});
  if (!identity) throw fail();
  const evidence = async () => {
    const persona = await store.read('candidate-persona', 'active');
    const membership = await store.read('membership', ctx.key);
    const saved = await store.read(scope, ctx.key);
    if (!persona || !membership || !saved || hex(persona.value.record.subject) !== identity.member
        || hex(persona.value.record.group) !== ctx.key || !permission(saved, identity.member).includes(ctx.remote)) throw fail();
    return [
      {scope, key: ctx.key, expectedRevision: saved.revision},
      {scope: 'candidate-persona', key: 'active', expectedRevision: persona.revision},
      {scope: 'membership', key: ctx.key, expectedRevision: membership.revision},
    ];
  };
  await evidence();
  return Object.freeze({
    async check() { await evidence(); },
    async snapshot() {
      const before = await evidence();
      const result = await openJourneyStore({store, group: ctx.key, actor: identity.member}).read();
      if (JSON.stringify(before) !== JSON.stringify(await evidence())) throw fail();
      return result.state;
    },
    async merge(snapshot, {signal} = {}) {
      const copy = validateState(snapshot, ctx.key);
      const checks = await evidence();
      const guarded = {...store, compareAndSwapMany: (changes, options) => store.compareAndSwapMany(changes, {...options, checks})};
      return openJourneyStore({store: guarded, group: ctx.key, actor: identity.member}).merge(copy, {signal});
    },
  });
}
