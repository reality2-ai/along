import {deliveryAckBytes, verifyDeliveryAck} from './delivery-ack.mjs';
const fail = () => new Error('AT delivery status unavailable');
// Latest public delivery status only; never authority to read or send a key.
export function openDeliveryHistory({store, group, owner, credential, recipient}) {
  const binding = Object.freeze({group, owner, credential, recipient});
  deliveryAckBytes({...binding, nonce: '00'.repeat(16), policyRevision: 1n, generation: 1n});
  const scope = 'along-at-sent:' + group, key = credential + ':' + recipient;
  const current = signal => { if (signal?.aborted) throw fail(); };
  const context = value => {
    if (!value || Object.keys(binding).some(k => value[k] !== binding[k])) throw fail();
    const result = Object.freeze({...binding, nonce: value.nonce, policyRevision: value.policyRevision, generation: value.generation});
    deliveryAckBytes(result); return result;
  };
  const load = async signal => {
    current(signal); const saved = await store.read(scope, key); current(signal);
    if (saved === null) return null;
    if (saved?.value?.format !== 1 || !['pending', 'confirmed'].includes(saved.value.state)) throw fail();
    const expected = context(saved.value.context);
    if (saved.value.state === 'confirmed') await verifyDeliveryAck(saved.value.acknowledgment, expected);
    current(signal);
    if ((await store.read(scope, key))?.revision !== saved.revision) throw fail();
    current(signal); return {saved, expected};
  };
  return Object.freeze({
    begin: async (value, {signal} = {}) => {
      const expected = context(value), prior = await load(signal);
      if (prior && (expected.nonce === prior.expected.nonce || expected.policyRevision < prior.expected.policyRevision
          || expected.generation < prior.expected.generation)) throw fail();
      current(signal);
      const result = await store.compareAndSwapMany([{scope, key, expectedRevision: prior?.saved.revision ?? 0,
        value: {format: 1, state: 'pending', context: expected}}], {signal});
      if (!result.applied) throw fail();
      return Object.freeze({status: 'pending', context: expected, storageRevision: result.revisions[0]});
    },
    confirm: async (packet, {signal} = {}) => {
      if (!(packet instanceof Uint8Array) || packet.length > 512) throw fail();
      const proof = packet.slice(), prior = await load(signal);
      if (!prior || prior.saved.value.state !== 'pending') throw fail();
      await verifyDeliveryAck(proof, prior.expected); current(signal);
      const result = await store.compareAndSwapMany([{scope, key, expectedRevision: prior.saved.revision,
        value: {format: 1, state: 'confirmed', context: prior.expected, acknowledgment: proof}}], {signal});
      if (!result.applied) throw fail();
      return Object.freeze({status: 'recipient-confirmed-saved', storageRevision: result.revisions[0]});
    },
    read: async ({signal} = {}) => {
      const value = await load(signal);
      return value ? Object.freeze({status: value.saved.value.state === 'confirmed' ? 'recipient-confirmed-saved' : 'pending',
        context: value.expected, storageRevision: value.saved.revision}) : Object.freeze({status: 'none'});
    },
  });
}
