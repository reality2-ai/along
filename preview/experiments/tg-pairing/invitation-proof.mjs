// Along browser-subset public challenge envelopes, not standard R2 wire formats.
// Initial epoch zero only. The caller must establish the invitation's source by
// local review; this exchange proves the named inviter holds its member key.
import {decodeSoftwareInvitation, encodeSoftwareInvitation} from './software-invitation.mjs';
import {invitationStatement} from './invitation.mjs';
const profile = 'along-browser-proof-v1';
const fail = () => new Error('Invitation proof unavailable');
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const bytes = (text, length) => {
  if (typeof text !== 'string' || text.length !== length * 2 || !/^[0-9a-f]+$/.test(text)) throw fail();
  return Uint8Array.from(text.match(/../g), b => parseInt(b, 16));
};
const descriptor = text => encodeSoftwareInvitation(decodeSoftwareInvitation(text));
const parse = (text, kind) => {
  if (typeof text !== 'string' || text.length > 2048) throw fail();
  let value; try { value = JSON.parse(text); } catch { throw fail(); }
  const fields = kind === 'challenge' ? ['profile', 'kind', 'descriptor', 'nonce'] : ['profile', 'kind', 'descriptor', 'nonce', 'certificate', 'proof'];
  if (!value || Array.isArray(value) || Object.keys(value).length !== fields.length
      || !fields.every(key => Object.hasOwn(value, key)) || value.profile !== profile || value.kind !== kind) throw fail();
  if (descriptor(value.descriptor) !== value.descriptor) throw fail();
  bytes(value.nonce, 16);
  if (kind === 'response') { bytes(value.certificate, 136); bytes(value.proof, 64); }
  return value;
};
export async function answerInvitationProof(invitation, request) {
  try {
    const value = parse(request, 'challenge');
    if (invitation.signal.aborted || value.descriptor !== invitation.descriptor) throw fail();
    const result = await invitation.respondChallenge(bytes(value.nonce, 16));
    if (invitation.signal.aborted) throw fail();
    return JSON.stringify({...value, kind: 'response', certificate: hex(result.certificate), proof: hex(result.proof)});
  } catch { throw fail(); }
}
export function createInvitationProof({wasm, reviewed, lifetimeMs = 60000}) {
  if (!reviewed?.signal || reviewed.signal.aborted || !Number.isFinite(lifetimeMs) || lifetimeMs < 1 || lifetimeMs > 60000) throw fail();
  const selected = descriptor(reviewed.descriptor), invitation = decodeSoftwareInvitation(selected);
  const nonce = crypto.getRandomValues(new Uint8Array(16)), started = performance.now();
  let closed = false, consumed = false, timer;
  const close = () => { closed = true; clearTimeout(timer); reviewed.signal.removeEventListener('abort', close); };
  const current = () => {
    if (closed || consumed || reviewed.signal.aborted || performance.now() < started || performance.now() - started >= lifetimeMs) { close(); throw fail(); }
  };
  reviewed.signal.addEventListener('abort', close, {once: true}); timer = setTimeout(close, lifetimeMs);
  const request = JSON.stringify({profile, kind: 'challenge', descriptor: selected, nonce: hex(nonce)});
  return Object.freeze({request, close,
    verify: response => {
      let membership, authorized;
      try {
        current();
        const value = parse(response, 'response');
        if (value.descriptor !== selected || value.nonce !== hex(nonce)) throw fail();
        membership = wasm.BrowserMembership.establish(invitation.group, 0n, 0n);
        authorized = membership.authorise_invitation(invitationStatement(wasm, invitation), bytes(value.certificate, 136), nonce, bytes(value.proof, 64));
        if (!authorized) throw fail();
        current(); consumed = true; close();
        const token = authorized; authorized = undefined;
        // Caller owns this WASM token and must consume it in the core ceremony
        // or free it. Cancellation must remain wired through reviewed.signal.
        return Object.freeze({authorized: token, invitation: decodeSoftwareInvitation(selected), signal: reviewed.signal});
      } catch { close(); throw fail(); }
      finally { authorized?.free(); membership?.free(); }
    },
  });
}
