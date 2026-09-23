// Public invitation descriptor for Along's browser subset, not a secret, trust
// decision, standard wire format or substitute for the candidate's challenge.
import {loadSoftwareIssuer} from './software-persona.mjs';
import {loadLocalPersona} from './local-persona.mjs';
import {invitationStatement} from './invitation.mjs';
const profile = 'along-browser-invitation-v1';
const hex = value => Array.from(value, b => b.toString(16).padStart(2, '0')).join('');
const fail = () => new Error('Browser invitation unavailable');
const fields = ['profile', 'group', 'issuer', 'code', 'validity'];
export function encodeSoftwareInvitation(value) {
  if (!value || typeof value.validity !== 'bigint' || value.role !== 'member'
      || ![['group', 32], ['issuer', 32], ['code', 16]].every(([name, length]) =>
        value[name] instanceof Uint8Array && value[name].length === length)) throw fail();
  const object = {profile, group: hex(value.group), issuer: hex(value.issuer), code: hex(value.code), validity: String(value.validity)};
  const text = JSON.stringify(object); decodeSoftwareInvitation(text); return text;
}
export function decodeSoftwareInvitation(text) {
  try {
    if (typeof text !== 'string' || text.length > 1024) throw fail();
    const value = JSON.parse(text);
    if (!value || Array.isArray(value) || Object.keys(value).length !== fields.length
        || !fields.every(field => Object.hasOwn(value, field)) || value.profile !== profile
        || typeof value.validity !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value.validity)) throw fail();
    const result = {role: 'member', validity: BigInt(value.validity)};
    if (result.validity > 0xffffffffffffffffn) throw fail();
    for (const [field, length] of [['group', 64], ['issuer', 64], ['code', 32]]) {
      if (typeof value[field] !== 'string' || value[field].length !== length || !/^[0-9a-f]+$/.test(value[field])) throw fail();
      result[field] = Uint8Array.from(value[field].match(/../g), b => parseInt(b, 16));
    }
    return result;
  } catch { throw fail(); }
}
// Trusted local UI begins this operation; later comparison/session confirmation
// must still gate the enrollment controller's use of issuer material.
export async function createSoftwareInvitation({wasm, store, expectedGroup, validity = 8n, signal, lifetimeMs = 60000}) {
  let custody, timer, closed = false, proofIssued = false, materialIssued = false;
  const controller = new AbortController();
  const close = () => { if (closed) return; closed = true; clearTimeout(timer); controller.abort(); custody?.close(); signal?.removeEventListener('abort', close); };
  const started = performance.now();
  const current = () => {
    if (closed || signal?.aborted || performance.now() < started || performance.now() - started >= lifetimeMs) { close(); throw fail(); }
  };
  signal?.addEventListener('abort', close, {once: true});
  try {
    if (!(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32
        || !Number.isFinite(lifetimeMs) || lifetimeMs < 1 || lifetimeMs > 60000) throw fail();
    const group = expectedGroup.slice(); current();
    custody = await loadSoftwareIssuer({wasm, store, expectedGroup: group, signal: controller.signal}); current();
    const identity = await loadLocalPersona({wasm, store, expectedGroup: group}); current();
    const issuer = Uint8Array.from(identity.member.match(/../g), b => parseInt(b, 16));
    const invitation = {group, issuer, code: crypto.getRandomValues(new Uint8Array(16)), validity, role: 'member'};
    const statement = invitationStatement(wasm, invitation), descriptor = encodeSoftwareInvitation(invitation);
    timer = setTimeout(close, Math.max(1, lifetimeMs - (performance.now() - started)));
    return Object.freeze({descriptor, invitation: () => decodeSoftwareInvitation(descriptor), signal: controller.signal, close,
      respondChallenge: async nonce => {
        try {
          current(); if (proofIssued || !(nonce instanceof Uint8Array) || nonce.length !== 16) throw fail();
          proofIssued = true; const snapshot = nonce.slice();
          const persona = await store.read('candidate-persona', 'active');
          const signer = await loadLocalPersona({wasm, store, expectedGroup: group});
          if (signer?.member !== hex(issuer)) throw fail();
          const proof = await signer.sign(wasm.tg_nonce_signing_bytes(statement, snapshot)); current();
          if ((await store.read('candidate-persona', 'active'))?.revision !== persona?.revision) throw fail();
          current();
          return {certificate: persona.value.record.certificate.slice(), proof};
        } catch { close(); throw fail(); }
      },
      enrollmentMaterial: async subject => {
        try {
          current(); if (!proofIssued || materialIssued) throw fail();
          materialIssued = true;
          const result = await custody.enrollmentMaterial(subject);
          try { current(); return result; } catch { result.destroy(); throw fail(); }
        } catch { close(); throw fail(); }
      },
    });
  } catch { close(); throw fail(); }
}
