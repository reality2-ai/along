// Browser enrollment exchange prototype. No membership install or key custody.
// Private contributions and session bytes are volatile; nothing is persisted.
import {invitationStatement} from './invitation.mjs';
import {createEnrollmentProtection} from './enrollment-protection.mjs';
const fixed = (value, length) => value instanceof Uint8Array && value.length === length;
const domain = new TextEncoder().encode('along-enrollment-commit-v1\0');
const digest = async (statement, transcript, publicKey, salt) => {
  const input = new Uint8Array(domain.length + statement.length + 96);
  input.set(domain); input.set(statement, domain.length);
  input.set(transcript, domain.length + statement.length);
  input.set(publicKey, domain.length + statement.length + 32); input.set(salt, domain.length + statement.length + 64);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', input));
};
export async function createEnrollmentExchange(wasm, invitation, role, channelTranscript, candidateCeremony) {
  if (!fixed(channelTranscript, 32)) throw new TypeError('Invalid channel transcript');
  const transcript = channelTranscript.slice();
  if (!['candidate', 'provisioner'].includes(role)) throw new TypeError('Invalid exchange role');
  const statement = invitationStatement(wasm, invitation);
  let pair = await crypto.subtle.generateKey('X25519', false, ['deriveBits']);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const salt = crypto.getRandomValues(new Uint8Array(32));
  let state = 'new', commitment, comparison, protection;
  const started = performance.now();
  const close = () => { state = 'closed'; pair = null; salt.fill(0); comparison?.fill(0); protection?.close(); };
  const timer = setTimeout(close, 60000);
  const stop = () => { clearTimeout(timer); close(); candidateCeremony?.close(); };
  const expect = value => {
    const elapsed = performance.now() - started;
    if (state !== value || !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= 60000) {
      stop(); throw new Error('Enrollment exchange is unavailable');
    }
  };
  const derive = async remote => {
    if (!fixed(remote, 32)) throw new Error('Invalid exchange contribution');
    const remoteKey = await crypto.subtle.importKey('raw', remote.slice(), 'X25519', false, []);
    expect('deriving');
    const session = new Uint8Array(await crypto.subtle.deriveBits({name: 'X25519', public: remoteKey}, pair.privateKey, 256));
    try {
      expect('deriving');
      if (session.every(byte => byte === 0)) throw new Error('Degenerate exchange contribution');
      const material = await crypto.subtle.importKey('raw', session, 'HKDF', false, ['deriveBits', 'deriveKey']);
      const boundSession = new Uint8Array(await crypto.subtle.deriveBits({name: 'HKDF', hash: 'SHA-256',
        salt: transcript, info: new TextEncoder().encode('along/enrollment/session/v1')}, material, 256));
      try { expect('deriving'); comparison = wasm.tg_ceremony_verification_string(boundSession, statement); }
      finally { boundSession.fill(0); }
      if (!fixed(comparison, 4)) throw new Error('Comparison derivation refused');
      protection = await createEnrollmentProtection(material, statement, transcript, role, () => expect('exchanged'));
      expect('deriving');
      pair = null; state = 'exchanged';
    } finally { session.fill(0); }
  };
  return Object.freeze({
    commit: async () => {
      if (role !== 'candidate') { stop(); throw new Error('Candidate must commit first'); }
      expect('new'); state = 'committing';
      try { const result = await digest(statement, transcript, publicKey, salt); expect('committing'); candidateCeremony?.candidate_commits(result); state = 'committed'; return result; }
      catch (error) { stop(); throw error; }
    },
    acceptCommit: value => {
      if (role !== 'provisioner' || !fixed(value, 32)) { stop(); throw new Error('Invalid candidate commitment'); }
      expect('new'); commitment = value.slice(); state = 'revealed'; return publicKey.slice();
    },
    reveal: async remote => {
      if (role !== 'candidate') { stop(); throw new Error('Invalid exchange role'); }
      expect('committed'); state = 'deriving';
      try { await derive(remote); candidateCeremony?.exchanged(remote, publicKey); return {publicKey: publicKey.slice(), salt: salt.slice()}; }
      catch (error) { stop(); throw error; }
    },
    acceptReveal: async value => {
      if (role !== 'provisioner') { stop(); throw new Error('Invalid exchange role'); }
      expect('revealed'); state = 'checking';
      try {
        if (!value || !fixed(value.publicKey, 32) || !fixed(value.salt, 32)) throw new Error('Invalid candidate reveal');
        const remote = value.publicKey.slice(), revealedSalt = value.salt.slice();
        const actual = await digest(statement, transcript, remote, revealedSalt); expect('checking');
        if (!actual.every((byte, index) => byte === commitment[index])) throw new Error('Candidate commitment mismatch');
        state = 'deriving'; await derive(remote);
      } catch (error) { stop(); throw error; }
    },
    verificationString: () => { expect('exchanged'); return comparison.slice(); },
    // Cryptographic carriage only. The link controls comparison confirmation;
    // the enclosing ceremony must validate claim/bundle semantics and custody.
    seal: async (kind, value) => { expect('exchanged'); try { return await protection.seal(kind, value); } catch (error) { stop(); throw error; } },
    open: async (kind, value) => { expect('exchanged'); try { return await protection.open(kind, value); } catch (error) { stop(); throw error; } },
    close: stop,
  });
}
