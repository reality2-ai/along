// Along's experimental application profile, not a normative R2 wire format.
// These public bytes identify an installation; they do not prove a commit.
// Send only after durable installation, over the confirmed protected session.
import {invitationStatement} from './invitation.mjs';
import {certificateCodec} from './certificate.mjs';

export async function installationReceipt(wasm, invitation, subject, certificate) {
  const expected = structuredClone(invitation);
  const member = subject instanceof Uint8Array ? subject.slice() : null;
  const cert = certificate instanceof Uint8Array ? certificate.slice() : null;
  if (!certificateCodec(wasm).authentic(cert, member, expected.group)) throw new Error('Receipt identity unavailable');
  const statement = invitationStatement(wasm, expected);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', cert));
  const result = new Uint8Array(154);
  result[0] = 1; result.set(statement, 1); result.set(member, 90); result.set(digest, 122);
  return result;
}

export async function verifyInstallationReceipt(wasm, invitation, subject, certificate, received) {
  if (!(received instanceof Uint8Array) || received.length !== 154) return false;
  const snapshot = received.slice();
  const expected = await installationReceipt(wasm, invitation, subject, certificate);
  return snapshot.every((byte, index) => byte === expected[index]);
}
