import {loadLocalATOwner} from './local-owner.mjs';
import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {openMembership} from '../tg-pairing/membership.mjs';
import {openCredentialPolicyStore} from './policy-store.mjs';
import {openLocalATVault} from './local-vault.mjs';
import {encodeCredentialDelivery} from './delivery-message.mjs';
const fail = () => new Error('AT credential delivery unavailable');
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

// Trusted session controller supplies the established group/peer of connection.
// A caller-provided object is not itself a security capability or peer proof.
export async function sendOwnerCredential({wasm, store, expectedGroup, peer, peerCertificate, nonce, connection}) {
  let packet, held, secret;
  try {
    if (!(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32
        || !(peer instanceof Uint8Array) || peer.length !== 32
        || !(peerCertificate instanceof Uint8Array) || peerCertificate.length !== 136
        || !(nonce instanceof Uint8Array) || nonce.length !== 16) throw fail();
    const group = expectedGroup.slice(), recipient = peer.slice(), proof = peerCertificate.slice(), request = nonce.slice();
    const signal = connection.signal;
    const current = () => { if (!signal || signal.aborted) throw fail(); };
    current(); await connection.authenticated(); current();
    const owner = await loadLocalATOwner({wasm, store, expectedGroup: group, signal});
    if (!owner) throw fail();
    const {binding} = owner;
    const anchor = await store.read('along-at-owners', binding.group);
    const membership = await store.read('membership', binding.group);
    const identity = await loadLocalPersona({wasm, store, expectedGroup: group});
    if (!identity || identity.member !== binding.owner || !anchor || !membership) throw fail();
    const subject = Uint8Array.from(identity.member.match(/../g), v => parseInt(v, 16));
    held = openMembership(store, wasm, group, subject);
    if (await held.peerStatus(proof, recipient) !== 'current') throw fail();
    const policy = await openCredentialPolicyStore({store, ...binding}).read({signal});
    if (policy.status !== 'policy-loaded' || !policy.policy.devices.includes(hex(recipient))) throw fail();
    const scope = 'along-at-policy:' + binding.owner, key = binding.group + ':' + binding.credential;
    const signed = await store.read(scope, key);
    if (signed?.revision !== policy.storageRevision) throw fail();
    const vault = openLocalATVault({wasm, store, ...binding});
    secret = await vault.getKey({signal}); current();
    packet = await encodeCredentialDelivery({nonce: request, recipient, policyBytes: signed.value.bytes,
      policySignature: signed.value.signature, key: secret, sign: identity.sign});
    secret = undefined;
    await connection.authenticated();
    if (await held.peerStatus(proof, recipient) !== 'current') throw fail();
    for (const [s, k, revision] of [[scope, key, signed.revision],
      ['along-at-owners', binding.group, anchor.revision], ['membership', binding.group, membership.revision]]) {
      if ((await store.read(s, k))?.revision !== revision) throw fail();
    }
    current(); await connection.send(packet);
    // Sending is not evidence that the recipient committed or acknowledged it.
    return Object.freeze({status: 'sent-unconfirmed', acknowledgmentContext: Object.freeze({...binding,
      recipient: hex(recipient), nonce: hex(request), policyRevision: policy.policy.revision, generation: policy.policy.generation})});
  } catch { throw fail(); }
  finally { secret = undefined; packet?.fill(0); held?.close(); }
}
