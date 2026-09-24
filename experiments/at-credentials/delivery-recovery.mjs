// Public historical receipt recovery over a controller-authenticated R2 session.
// The controller supplies the actual connection peer; plain objects are not proof.
import {deliveryAckBytes} from './delivery-ack.mjs';
import {loadATBinding, loadLocalATOwner} from './local-owner.mjs';
import {openLocalATVault} from './local-vault.mjs';
import {openDeliveryHistory} from './delivery-history.mjs';
const domain = new TextEncoder().encode('along/at-recover/v1\0');
const ackPrefix = new TextEncoder().encode('along/at-saved/v1\0').length;
const fail = () => new Error('AT delivery recovery unavailable');
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const identityBytes = value => value instanceof Uint8Array && value.length === 32;
export function encodeRecoveryRequest(context) {
  const body = deliveryAckBytes(context).slice(ackPrefix);
  const packet = new Uint8Array(domain.length + body.length);
  packet.set(domain); packet.set(body, domain.length); return packet;
}
export function decodeRecoveryRequest(packet) {
  if (!(packet instanceof Uint8Array) || packet.length !== domain.length + 144
      || !domain.every((v, i) => packet[i] === v)) throw fail();
  const snapshot = packet.slice(), context = {}; let offset = domain.length;
  for (const [field, length] of Object.entries({group: 32, owner: 32, credential: 16, recipient: 32, nonce: 16})) {
    context[field] = hex(snapshot.slice(offset, offset + length)); offset += length;
  }
  for (const field of ['policyRevision', 'generation']) {
    context[field] = new DataView(snapshot.buffer).getBigUint64(offset); offset += 8;
  }
  deliveryAckBytes(context); return Object.freeze(context);
}
async function authenticated(connection) {
  if (!connection?.signal || connection.signal.aborted) throw fail();
  await connection.authenticated();
  if (connection.signal.aborted) throw fail();
}
export async function requestDeliveryRecovery({wasm, store, expectedGroup, peer, connection}) {
  try {
    if (!identityBytes(expectedGroup) || !identityBytes(peer)) throw fail();
    const group = expectedGroup.slice(), recipient = hex(peer.slice());
    await authenticated(connection);
    const owner = await loadLocalATOwner({wasm, store, expectedGroup: group, signal: connection.signal});
    if (!owner) throw fail();
    const history = openDeliveryHistory({store, ...owner.binding, recipient});
    const pending = await history.read({signal: connection.signal});
    if (pending.status !== 'pending') throw fail();
    const packet = encodeRecoveryRequest(pending.context);
    await authenticated(connection); await connection.send(packet);
    return Object.freeze({status: 'confirmation-requested'});
  } catch { throw fail(); }
}
export async function answerDeliveryRecovery({wasm, store, expectedGroup, peer, connection, packet}) {
  try {
    if (!identityBytes(expectedGroup) || !identityBytes(peer)) throw fail();
    const context = decodeRecoveryRequest(packet), group = expectedGroup.slice(), sender = hex(peer.slice());
    await authenticated(connection);
    const anchor = await store.read('along-at-owners', hex(group));
    const loaded = await loadATBinding({wasm, store, expectedGroup: group, signal: connection.signal});
    if (!loaded || loaded.role !== 'recipient' || sender !== loaded.binding.owner
        || ['group', 'owner', 'credential'].some(field => context[field] !== loaded.binding[field])) throw fail();
    const vault = openLocalATVault({wasm, store, ...loaded.binding});
    const receipt = await vault.recoverAcknowledgment(context, {signal: connection.signal});
    await authenticated(connection);
    if (!anchor || (await store.read('along-at-owners', hex(group)))?.revision !== anchor.revision) throw fail();
    await connection.send(receipt);
    return Object.freeze({status: 'confirmation-sent'});
  } catch { throw fail(); }
}
