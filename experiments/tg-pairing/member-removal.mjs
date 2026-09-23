import {loadSoftwareIssuer} from './software-persona.mjs';
import {openMembership} from './membership.mjs';

const fixed = (value, length) => value instanceof Uint8Array && value.length === length;
const hex = value => Array.from(value, b => b.toString(16).padStart(2, '0')).join('');
const refuse = () => new Error('Group member removal unavailable');

// Called only after a separate trusted review. Membership's retained revocations
// are also the durable outbound evidence: no volatile-only delivery queue.
export async function removeSoftwareMember({wasm, store, expectedGroup, subject, certificate, reason = 0, signal}) {
  if (!fixed(expectedGroup, 32) || !fixed(subject, 32) || !fixed(certificate, 136)
      || !Number.isInteger(reason) || reason < 0 || reason > 3
      || store.capabilities?.transactionChecks !== true) throw refuse();
  const group = expectedGroup.slice(), peer = subject.slice(), cert = certificate.slice();
  const groupId = hex(group), peerId = hex(peer);
  for (let attempt = 0; attempt < 8; attempt++) {
    if (signal?.aborted) throw refuse();
    const persona = await store.read('candidate-persona', 'active');
    const bootstrap = await store.read('persona-bootstrap', 'initial');
    const custody = await store.read('along-browser-issuer', groupId);
    let issuer, membership;
    try {
      issuer = await loadSoftwareIssuer({wasm, store, expectedGroup: group, signal});
      if (issuer.member === peerId) throw refuse(); // Self removal requires its own recovery flow.
      const member = Uint8Array.from(issuer.member.match(/../g), b => parseInt(b, 16));
      membership = openMembership(store, wasm, group, member);
      const saved = await store.read('membership', groupId);
      const standing = await membership.peerStatus(cert, peer);
      if (!['current', 'revoked'].includes(standing) || await membership.status() !== 'current') throw refuse();
      if ((await store.read('membership', groupId))?.revision !== saved?.revision) continue;
      const previous = saved.value.revocations.find(value => hex(value.subject) === peerId);
      if (previous) {
        if (signal?.aborted) throw refuse();
        return {status: 'removed-locally', evidence: structuredClone(previous), delivered: false};
      }
      if (standing !== 'current' || saved.value.current !== 0n || saved.value.revocations.length >= 256) throw refuse();
      const sequence = saved.value.revocations.reduce((max, value) => value.sequence > max ? value.sequence : max, 0n) + 1n;
      const evidence = await issuer.issueRevocation({subject: peer, sequence, reason});
      const value = structuredClone(saved.value); value.revocations.push(evidence);
      const result = await store.compareAndSwapMany([
        {scope: 'membership', key: groupId, expectedRevision: saved.revision, value},
      ], {signal, checks: [
        {scope: 'candidate-persona', key: 'active', expectedRevision: persona?.revision ?? 0},
        {scope: 'persona-bootstrap', key: 'initial', expectedRevision: bootstrap?.revision ?? 0},
        {scope: 'along-browser-issuer', key: groupId, expectedRevision: custody?.revision ?? 0},
      ]});
      if (!result.applied) continue;
      // Commit is authoritative even if cancellation or notification fails now.
      // The existing verifier broadcasts authenticated invalidation to local tabs.
      try { await membership.applyRevocation(evidence); } catch {}
      return {status: 'removed-locally', evidence: structuredClone(evidence), delivered: false};
    } finally { membership?.close(); issuer?.close(); }
  }
  throw refuse();
}
