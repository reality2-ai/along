// Along application-secret storage using browser software custody. This is not
// hardware sealing, TG issuer custody, or protection against same-origin script.
import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {openCredentialPolicyStore} from './policy-store.mjs';
import {openMembership} from '../tg-pairing/membership.mjs';
import {credentialPolicyBytes} from './policy.mjs';
import {verifyCredentialDelivery} from './delivery-message.mjs';
import {signDeliveryAck} from './delivery-ack.mjs';
const fail = () => new Error('Local AT credential unavailable');
const hex = value => Array.from(value, b => b.toString(16).padStart(2, '0')).join('');
const token = value => typeof value === 'string' && /^[\x21-\x7e]{1,512}$/.test(value);
const bytes = (value, length) => value instanceof Uint8Array && value.length === length;
export function openLocalATVault({wasm, store, group, owner, credential}) {
  if (store.capabilities?.transactionChecks !== true) throw fail();
  // Also validates and snapshots the fixed caller-established binding.
  const policies = openCredentialPolicyStore({store, group, owner, credential});
  const groupBytes = Uint8Array.from(group.match(/../g), v => parseInt(v, 16));
  const scope = 'along-at-secret:' + owner, key = group + ':' + credential;
  const policyScope = 'along-at-policy:' + owner;
  const checkSignal = signal => { if (signal?.aborted) throw fail(); };
  const unchanged = async (checks, signal) => {
    for (const check of checks) {
      checkSignal(signal);
      const saved = await store.read(check.scope, check.key); checkSignal(signal);
      if ((saved?.revision ?? 0) !== check.expectedRevision) throw fail();
    }
  };
  const access = async signal => {
    checkSignal(signal);
    const persona = await store.read('candidate-persona', 'active');
    const membership = await store.read('membership', group);
    const anchor = await store.read('along-at-owners', group);
    if (!persona || !membership || anchor?.value?.format !== 1
        || anchor.value.group !== group || anchor.value.owner !== owner || anchor.value.credential !== credential) throw fail();
    const evidenceScope = persona.value.origin === 'initial' ? 'persona-bootstrap' : 'enrollment-invitations';
    const evidenceKey = persona.value.origin === 'initial' ? 'initial' : group + ':' + hex(persona.value.invitation.code);
    const evidence = await store.read(evidenceScope, evidenceKey);
    if (!evidence) throw fail();
    const identity = await loadLocalPersona({wasm, store, expectedGroup: groupBytes});
    if (!identity || identity.member !== hex(persona.value.record.subject)) throw fail();
    const loaded = await policies.read({signal});
    if (loaded.status !== 'policy-loaded' || !loaded.policy.devices.includes(identity.member)) throw fail();
    const checks = [
      {scope: 'candidate-persona', key: 'active', expectedRevision: persona.revision},
      {scope: 'membership', key: group, expectedRevision: membership.revision},
      {scope: 'along-at-owners', key: group, expectedRevision: anchor.revision},
      {scope: evidenceScope, key: evidenceKey, expectedRevision: evidence.revision},
      {scope: policyScope, key, expectedRevision: loaded.storageRevision},
    ];
    await unchanged(checks, signal);
    return {policy: loaded.policy, member: identity.member, checks};
  };
  const aad = value => new TextEncoder().encode(JSON.stringify(['along/local-at-secret/v1', group, owner, credential,
    value.member, value.generation.toString(), value.policyRevision.toString()]));
  const validStored = value => value?.format === 1 && typeof value.generation === 'bigint' && value.generation > 0n
    && typeof value.policyRevision === 'bigint' && value.policyRevision > 0n
    && typeof value.member === 'string' && /^[0-9a-f]{64}$/.test(value.member)
    && bytes(value.iv, 12) && value.ciphertext instanceof Uint8Array && value.ciphertext.length >= 17 && value.ciphertext.length <= 528
    && value.wrappingKey instanceof CryptoKey && value.wrappingKey.type === 'secret' && !value.wrappingKey.extractable
    && value.wrappingKey.algorithm.name === 'AES-GCM' && value.wrappingKey.algorithm.length === 256
    && value.wrappingKey.usages.length === 2 && ['encrypt', 'decrypt'].every(use => value.wrappingKey.usages.includes(use));
  const encryptRecord = async (plaintext, context, signal) => {
    const wrappingKey = await crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
    checkSignal(signal);
    const record = {format: 1, member: context.member, generation: context.policy.generation,
      policyRevision: context.policy.revision, wrappingKey, iv: crypto.getRandomValues(new Uint8Array(12))};
    record.ciphertext = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv: record.iv,
      additionalData: aad(record)}, wrappingKey, plaintext));
    checkSignal(signal);
    if (!validStored(record)) throw fail();
    return record;
  };
  const readKey = async signal => {
    let plaintext;
    try {
      const context = await access(signal), saved = await store.read(scope, key);
      checkSignal(signal);
      const record = saved?.value;
      if (!validStored(record) || record.member !== context.member || record.generation !== context.policy.generation
          || record.policyRevision > context.policy.revision) throw fail();
      plaintext = new Uint8Array(await crypto.subtle.decrypt({name: 'AES-GCM', iv: record.iv,
        additionalData: aad(record)}, record.wrappingKey, record.ciphertext));
      await unchanged([...context.checks, {scope, key, expectedRevision: saved.revision}], signal);
      const value = new TextDecoder('utf-8', {fatal: true}).decode(plaintext);
      if (!token(value)) throw fail();
      return value; // Trusted direct provider client only; never log or cache it.
    } catch { throw fail(); } finally { plaintext?.fill(0); }
  };
  return Object.freeze({
    // Caller must first establish owner trust, accept the granting policy and
    // authenticate the owner channel. This only supplies local installation.
    prepareDelivery: async ({ownerCertificate, signal} = {}) => {
      const lifetime = new AbortController(), started = performance.now();
      const cancel = () => lifetime.abort();
      signal?.addEventListener('abort', cancel, {once: true});
      let consumed = false;
      const close = () => { cancel(); signal?.removeEventListener('abort', cancel); };
      const current = () => {
        const elapsed = performance.now() - started;
        if (signal?.aborted || lifetime.signal.aborted || consumed || !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= 60000) throw fail();
      };
      try {
        current();
        if (!bytes(ownerCertificate, 136)) throw fail();
        const proof = ownerCertificate.slice(), context = await access(lifetime.signal);
        const subject = Uint8Array.from(context.member.match(/../g), v => parseInt(v, 16));
        const ownerBytes = Uint8Array.from(owner.match(/../g), v => parseInt(v, 16));
        const verifyOwner = async () => {
          current(); const held = openMembership(store, wasm, groupBytes, subject);
          try { if (await held.peerStatus(proof, ownerBytes) !== 'current') throw fail(); }
          finally { held.close(); }
          current();
        };
        await verifyOwner();
        const requestScope = 'along-at-request:' + owner;
        const previous = await store.read(requestScope, key);
        const nonce = crypto.getRandomValues(new Uint8Array(16));
        const request = {format: 1, state: 'pending', nonce, member: context.member,
          policyRevision: context.policy.revision, generation: context.policy.generation};
        current();
        const begun = await store.compareAndSwapMany([{scope: requestScope, key,
          expectedRevision: previous?.revision ?? 0, value: request}], {signal: lifetime.signal, checks: context.checks});
        if (!begun.applied) throw fail();
        current();
        return Object.freeze({nonce: nonce.slice(), close,
          acknowledgment: async ({signal: ackSignal} = {}) => {
            try {
              if (!consumed) throw fail();
              checkSignal(ackSignal);
              const journal = await store.read(requestScope, key), saved = await store.read(scope, key);
              const value = journal?.value, record = saved?.value;
              if (value?.state !== 'consumed' || !bytes(value.nonce, 16) || hex(value.nonce) !== hex(nonce)
                  || value.member !== context.member || value.generation !== context.policy.generation
                  || value.policyRevision !== context.policy.revision || !validStored(record)
                  || record.member !== context.member || record.generation !== context.policy.generation
                  || record.policyRevision !== context.policy.revision) throw fail();
              const identity = await loadLocalPersona({wasm, store, expectedGroup: groupBytes});
              if (identity?.member !== context.member) throw fail();
              const receipt = await signDeliveryAck({group, owner, credential, recipient: context.member,
                nonce: hex(nonce), generation: context.policy.generation, policyRevision: context.policy.revision}, identity.sign);
              await unchanged([{scope: requestScope, key, expectedRevision: journal.revision},
                {scope, key, expectedRevision: saved.revision}], ackSignal);
              return receipt;
            } catch { throw fail(); }
          },
          install: async packet => {
            let plaintext, snapshot;
            try {
              if (!(packet instanceof Uint8Array) || packet.length > 2048) throw fail();
              snapshot = packet.slice();
              current(); await verifyOwner();
              const delivered = await verifyCredentialDelivery(snapshot, {group, owner, credential, recipient: subject, nonce,
                afterRevision: context.policy.revision - 1n, minimumGeneration: context.policy.generation});
              const expected = credentialPolicyBytes(context.policy);
              if (delivered.policyBytes.length !== expected.length || !expected.every((v, i) => v === delivered.policyBytes[i])) throw fail();
              plaintext = new TextEncoder().encode(delivered.key); delivered.key = undefined;
              const previousKey = await store.read(scope, key); current();
              if (previousKey && (!validStored(previousKey.value) || previousKey.value.generation >= context.policy.generation)) throw fail();
              const record = await encryptRecord(plaintext, context, lifetime.signal); current();
              const result = await store.compareAndSwapMany([
                {scope, key, expectedRevision: previousKey?.revision ?? 0, value: record},
                {scope: requestScope, key, expectedRevision: begun.revisions[0], value: {...request, state: 'consumed'}},
              ], {signal: lifetime.signal, checks: context.checks});
              if (!result.applied) throw fail();
              consumed = true; close();
              return Object.freeze({status: 'credential-saved', generation: record.generation, storageRevision: result.revisions[0]});
            } catch { throw fail(); } finally { plaintext?.fill(0); snapshot?.fill(0); }
          },
        });
      } catch { close(); throw fail(); }
    },
    saveOwnerKey: async (value, {signal} = {}) => {
      let plaintext;
      try {
        if (!token(value)) throw fail();
        plaintext = new TextEncoder().encode(value);
        const context = await access(signal);
        if (context.member !== owner) throw fail();
        const previous = await store.read(scope, key); checkSignal(signal);
        if (previous && (!validStored(previous.value) || previous.value.generation >= context.policy.generation)) throw fail();
        const record = await encryptRecord(plaintext, context, signal);
        const result = await store.compareAndSwapMany([{scope, key, expectedRevision: previous?.revision ?? 0, value: record}],
          {signal, checks: context.checks});
        if (!result.applied) throw fail();
        return Object.freeze({status: 'credential-saved', generation: record.generation, storageRevision: result.revisions[0]});
      } catch { throw fail(); } finally { plaintext?.fill(0); }
    },
    getKey: ({signal} = {}) => readKey(signal),
    inspect: async ({signal} = {}) => {
      try {
        const context = await access(signal), saved = await store.read(scope, key);
        const checks = [...context.checks, {scope, key, expectedRevision: saved?.revision ?? 0}];
        const canSave = context.member === owner;
        let status;
        if (!saved) status = 'missing';
        else {
          const record = saved.value;
          if (!validStored(record) || record.member !== context.member || record.policyRevision > context.policy.revision
              || record.generation > context.policy.generation) throw fail();
          if (record.generation < context.policy.generation) status = 'replacement-needed';
          else { await readKey(signal); status = 'saved-unverified'; }
        }
        await unchanged(checks, signal);
        // Only local state, never a credential or proof of provider acceptance.
        return Object.freeze({status, canSave: canSave && status !== 'saved-unverified'});
      } catch { return Object.freeze({status: 'unavailable', canSave: false}); }
    },
  });
}
