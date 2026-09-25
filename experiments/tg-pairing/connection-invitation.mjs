// Along-specific bootstrap envelope, not an R2 membership credential. The secret
// admits only a short-lived signalling channel. Never store or log this envelope.
import {decodeSoftwareInvitation, encodeSoftwareInvitation} from './software-invitation.mjs';
import {hiveEndpoint} from '../r2-current/hive-transport.mjs';
const PROFILE = 'along-connect-v1';
const FIELDS = ['profile','relay','descriptor','expires','secret','routingGroup','provisioner','candidate'];
const MAX_LIFETIME = 60000;
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2,'0')).join('');
export const connectionBytes = value => Uint8Array.from(value.match(/../g), b => parseInt(b,16));
const refuse = () => Error('Connection invitation unavailable or expired');
export function readConnectionInvitation(text, {now = Date.now()} = {}) {
  if (typeof text !== 'string' || text.length > 2048) throw refuse();
  let value; try { value = JSON.parse(text); } catch { throw refuse(); }
  if (!value || Array.isArray(value) || Object.keys(value).length !== FIELDS.length
      || !FIELDS.every(k => Object.hasOwn(value,k)) || value.profile !== PROFILE
      || !Number.isSafeInteger(value.expires) || value.expires <= now || value.expires > now + MAX_LIFETIME
      || !['secret','routingGroup','provisioner','candidate'].every(k => typeof value[k] === 'string' && /^[0-9a-f]{64}$/.test(value[k]))) throw refuse();
  if (new Set([value.routingGroup,value.provisioner,value.candidate]).size !== 3
      || hiveEndpoint(value.relay) !== value.relay
      || encodeSoftwareInvitation(decodeSoftwareInvitation(value.descriptor)) !== value.descriptor) throw refuse();
  return Object.freeze(value);
}
export async function createConnectionInvitation({descriptor, relay, lifetimeMs = MAX_LIFETIME}) {
  if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1 || lifetimeMs > MAX_LIFETIME) throw refuse();
  const expires = Date.now() + lifetimeMs;
  // Fresh public keys give the transport unrelated, temporary routing names.
  // Their private halves are not retained or used to authorize membership.
  const publicKey = async () => {
    const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign','verify']);
    return hex(new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey)));
  };
  const [routingGroup,provisioner,candidate] = await Promise.all([publicKey(),publicKey(),publicKey()]);
  const value = {profile:PROFILE,relay:hiveEndpoint(relay),descriptor,expires,
    secret:hex(crypto.getRandomValues(new Uint8Array(32))),routingGroup,provisioner,candidate};
  const text = JSON.stringify(value); readConnectionInvitation(text); return text;
}
// The fragment is not sent in HTTP requests. The receiving view must remove it
// from history immediately, then obtain consent before opening the relay.
export function connectionInvitationLink(base, invitation) {
  readConnectionInvitation(invitation);
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password || url.search) throw refuse();
  url.hash = 'connect=' + encodeURIComponent(invitation); return url.href;
}
export function invitationFromLink(link) {
  const url = new URL(link);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || !url.hash.startsWith('#connect=')) throw refuse();
  const text = decodeURIComponent(url.hash.slice(9)); readConnectionInvitation(text); return text;
}
export function connectionContext(value) {
  // Endpoint, proof descriptor, expiry and both routing names are key-bound.
  return JSON.stringify(FIELDS.filter(k => k !== 'secret').map(k => value[k]));
}
