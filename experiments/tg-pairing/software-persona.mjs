// Along's explicitly selected browser-only R2 subset. Encrypted software custody
// does NOT satisfy R2 L5 hardware-rooted sealing or resist same-origin code.
import {certificateCodec} from './certificate.mjs';
import {loadLocalPersona} from './local-persona.mjs';
import {openMembership} from './membership.mjs';
const scope = 'along-browser-issuer';
const bytes = (value, length) => value instanceof Uint8Array && value.length === length;
const hex = value => Array.from(value, b => b.toString(16).padStart(2, '0')).join('');
const fail = () => new Error('Browser group custody unavailable');
const aad = (group, member) => new TextEncoder().encode(JSON.stringify(['along/software-issuer/v1', group, member]));
const current = signal => { if (signal?.aborted) throw fail(); };
const directoryScope = 'along-issued-members-v1';
function directory(value, wasm, group) {
  if (value === undefined) return [];
  if (!value || value.format !== 1 || !Array.isArray(value.members) || value.members.length > 256) throw fail();
  const seen = new Set(), codec = certificateCodec(wasm);
  return value.members.map(entry => {
    if (!bytes(entry?.subject, 32) || !codec.authentic(entry.certificate, entry.subject, group)
        || seen.has(hex(entry.subject))) throw fail();
    seen.add(hex(entry.subject));
    return {subject: entry.subject.slice(), certificate: entry.certificate.slice()};
  });
}
// Issued certificates, not a live roster or proof that enrollment completed.
export async function readIssuedMembers({wasm, store, expectedGroup}) {
  const identity = await loadLocalPersona({wasm, store, expectedGroup});
  if (identity?.origin !== 'initial') throw fail();
  const saved = await store.read(directoryScope, hex(expectedGroup));
  return directory(saved?.value, wasm, expectedGroup);
}

// Explicit first use only; never a restore failure fallback or identity migration.
export async function initializeSoftwarePersona({wasm, store, signal}) {
  let secret;
  try {
    if (store.capabilities?.transactionChecks !== true) throw fail();
    current(signal);
    if (await store.read('candidate-persona', 'active') || await store.read('persona-bootstrap', 'initial')) throw fail();
    const issuer = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    const member = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
    const group = new Uint8Array(await crypto.subtle.exportKey('raw', issuer.publicKey));
    const subject = new Uint8Array(await crypto.subtle.exportKey('raw', member.publicKey));
    const groupId = hex(group), memberId = hex(subject), codec = certificateCodec(wasm);
    const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', issuer.privateKey, codec.signingBytes(subject, group, 0n)));
    const certificate = codec.encode(subject, group, 0n, signature);
    const wrappingKey = await crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    secret = new Uint8Array(await crypto.subtle.exportKey('pkcs8', issuer.privateKey));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: aad(groupId, memberId)}, wrappingKey, secret));
    secret.fill(0); secret = undefined; current(signal);
    const result = await store.compareAndSwapMany([
      {scope: 'candidate-persona', key: 'active', expectedRevision: 0, value: {format: 1, origin: 'initial', claim: 'open', epoch: 0n,
        record: {format: 1, custody: 'browser-nonextractable-unqualified', group, subject, certificate, privateKey: member.privateKey}}},
      {scope: 'persona-bootstrap', key: 'initial', expectedRevision: 0, value: {format: 1, group, subject, profile: 'along-browser-software-v1'}},
      {scope: 'membership', key: groupId, expectedRevision: 0, value: {format: 1, group, subject, certificate, current: 0n, depth: 0n, revocations: []}},
      {scope, key: groupId, expectedRevision: 0, value: {format: 1, profile: 'along-browser-software-v1', member: memberId, wrappingKey, iv, ciphertext}},
    ], {signal});
    if (!result.applied) throw fail();
    return Object.freeze({status: 'created-local', group: groupId, member: memberId, custody: 'encrypted-browser-software'});
  } catch { throw fail(); } finally { secret?.fill(0); }
}

// The trusted enrollment controller authorizes each issuance. This interface
// supplies custody, not a human-consent decision or a qualifying platform grade.
export async function loadSoftwareIssuer({wasm, store, expectedGroup, signal}) {
  let plaintext, closed = false;
  try {
    if (!bytes(expectedGroup, 32)) throw fail();
    const group = expectedGroup.slice(), groupId = hex(group);
    current(signal);
    const persona = await loadLocalPersona({wasm, store, expectedGroup: group});
    const bootstrap = await store.read('persona-bootstrap', 'initial');
    const saved = await store.read(scope, groupId), value = saved?.value;
    if (!persona || persona.origin !== 'initial' || bootstrap?.value?.profile !== 'along-browser-software-v1'
        || value?.format !== 1 || value.profile !== 'along-browser-software-v1' || value.member !== persona.member
        || !bytes(value.iv, 12) || !(value.ciphertext instanceof Uint8Array) || value.ciphertext.length < 17 || value.ciphertext.length > 256
        || !(value.wrappingKey instanceof CryptoKey) || value.wrappingKey.extractable || value.wrappingKey.type !== 'secret'
        || value.wrappingKey.algorithm.name !== 'AES-GCM' || value.wrappingKey.algorithm.length !== 256
        || value.wrappingKey.usages.length !== 2 || !['encrypt', 'decrypt'].every(u => value.wrappingKey.usages.includes(u))) throw fail();
    plaintext = new Uint8Array(await crypto.subtle.decrypt({name: 'AES-GCM', iv: value.iv,
      additionalData: aad(groupId, persona.member)}, value.wrappingKey, value.ciphertext));
    let key = await crypto.subtle.importKey('pkcs8', plaintext, 'Ed25519', false, ['sign']);
    // RFC 8410's seed-only Ed25519 PKCS#8 form emitted by this profile's
    // WebCrypto export. Refuse other encodings rather than guessing a seed.
    const prefix = Uint8Array.of(0x30, 0x2e, 2, 1, 0, 0x30, 5, 6, 3, 0x2b, 0x65, 0x70, 4, 0x22, 4, 0x20);
    if (plaintext.length !== 48 || !prefix.every((v, i) => plaintext[i] === v)) throw fail();
    let derivationKey = await crypto.subtle.importKey('raw', plaintext.subarray(16), 'HKDF', false, ['deriveBits']);
    plaintext.fill(0); plaintext = undefined;
    const publicKey = await crypto.subtle.importKey('raw', group, 'Ed25519', false, ['verify']);
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    if (!await crypto.subtle.verify('Ed25519', publicKey, await crypto.subtle.sign('Ed25519', key, challenge), challenge)) throw fail();
    const check = async () => {
      current(signal); if (closed) throw fail();
      if ((await store.read(scope, groupId))?.revision !== saved.revision
          || (await store.read('persona-bootstrap', 'initial'))?.revision !== bootstrap.revision) throw fail();
      const identity = await loadLocalPersona({wasm, store, expectedGroup: group});
      if (identity?.member !== persona.member || identity.origin !== 'initial') throw fail();
      current(signal); if (closed) throw fail();
    };
    await check();
    const close = () => { closed = true; key = undefined; derivationKey = undefined; signal?.removeEventListener('abort', close); };
    signal?.addEventListener('abort', close, {once: true});
    const issueCertificate = async subject => {
        try {
          if (!bytes(subject, 32)) throw fail();
          const member = subject.slice(), codec = certificateCodec(wasm);
          await check();
          const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', key, codec.signingBytes(member, group, 0n)));
          const certificate = codec.encode(member, group, 0n, signature);
          // Retain the public target before releasing its certificate/material.
          // An interrupted enrollment can therefore still be reviewed/removed.
          for (let attempt = 0; attempt < 8; attempt++) {
            await check();
            const identity = await store.read('candidate-persona', 'active');
            const standing = await store.read('membership', groupId);
            const membership = openMembership(store, wasm, group, identity.value.record.subject);
            try { if (await membership.peerStatus(certificate, member) !== 'current') throw fail(); }
            finally { membership.close(); }
            const held = await store.read(directoryScope, groupId);
            const members = directory(held?.value, wasm, group);
            const existing = members.find(entry => hex(entry.subject) === hex(member));
            if (existing) {
              await check();
              if ((await store.read('membership', groupId))?.revision !== standing?.revision) continue;
              return certificate;
            }
            if (members.length >= 256) throw fail();
            members.push({subject: member, certificate});
            const result = await store.compareAndSwapMany([{scope: directoryScope, key: groupId,
              expectedRevision: held?.revision ?? 0, value: {format: 1, members}}], {signal, checks: [
              {scope, key: groupId, expectedRevision: saved.revision},
              {scope: 'persona-bootstrap', key: 'initial', expectedRevision: bootstrap.revision},
              {scope: 'candidate-persona', key: 'active', expectedRevision: identity?.revision ?? 0},
              {scope: 'membership', key: groupId, expectedRevision: standing?.revision ?? 0},
            ]});
            if (result.applied) { await check(); return certificate; }
          }
          throw fail();
        } catch { throw fail(); }
      };
    return Object.freeze({group: groupId, member: persona.member, custody: 'encrypted-browser-software', close,
      issueCertificate,
      // Produces public signed evidence only. The caller must durably apply it
      // and deliver it to remaining members before claiming group-wide removal.
      // This profile currently enrols at epoch zero; rotation remains unfinished.
      issueRevocation: async ({subject, sequence, reason}) => {
        try {
          if (!bytes(subject, 32) || typeof sequence !== 'bigint' || sequence < 1n
              || sequence > 0xffffffffffffffffn || !Number.isInteger(reason) || reason < 0 || reason > 3) throw fail();
          const member = subject.slice(), epoch = 0n;
          await check();
          const statement = wasm.tg_revocation_signing_bytes(member, epoch, sequence, reason);
          const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', key, statement));
          await check();
          return {subject: member, epoch, sequence, reason, signature};
        } catch { throw fail(); }
      },
      enrollmentMaterial: async subject => {
        let payloadKey, integrityKey;
        try {
          if (!bytes(subject, 32)) throw fail();
          const member = subject.slice(), certificate = await issueCertificate(member);
          const checkRecipient = async () => {
            await check();
            const local = Uint8Array.from(persona.member.match(/../g), byte => parseInt(byte, 16));
            const membership = openMembership(store, wasm, group, local);
            try { if (await membership.peerStatus(certificate, member) !== 'current') throw fail(); }
            finally { membership.close(); }
          };
          const derive = async purpose => new Uint8Array(await crypto.subtle.deriveBits({name: 'HKDF', hash: 'SHA-256',
            salt: group, info: new TextEncoder().encode(purpose)}, derivationKey, 256));
          await checkRecipient(); payloadKey = await derive('r2/v0/group/payload');
          await checkRecipient(); integrityKey = await derive('r2/v0/group/integrity'); await checkRecipient();
          return Object.freeze({certificate, epoch: 0n, payloadKey, integrityKey,
            destroy: () => { payloadKey.fill(0); integrityKey.fill(0); }});
        } catch { payloadKey?.fill(0); integrityKey?.fill(0); throw fail(); }
      },
    });
  } catch { throw fail(); } finally { plaintext?.fill(0); }
}
