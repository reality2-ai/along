// Along application policy, not an R2 wire format or membership grant.
// A verified signature still needs current TG standing and atomic local policy
// acceptance before it can authorize credential delivery or a provider request.
const domain = 'along/at-credential-policy/v1';
const max = 0xffffffffffffffffn;
const fail = () => new Error('Credential policy unavailable');
const hex = (value, length) => typeof value === 'string' && value.length === length * 2 && /^[0-9a-f]+$/.test(value);
const counter = value => typeof value === 'bigint' && value >= 1n && value <= max;
const names = ['group', 'owner', 'credential', 'revision', 'generation', 'devices'];
function checked(value) {
  if (!value || Reflect.ownKeys(value).length !== names.length || !names.every(key => Object.hasOwn(value, key))
      || !hex(value.group, 32) || !hex(value.owner, 32) || !hex(value.credential, 16)
      || !counter(value.revision) || !counter(value.generation) || !Array.isArray(value.devices)
      || value.devices.length > 16 || !value.devices.every(device => hex(device, 32))) throw fail();
  const devices = [...value.devices].sort();
  if (new Set(devices).size !== devices.length) throw fail();
  return Object.freeze({group: value.group, owner: value.owner, credential: value.credential,
    revision: value.revision, generation: value.generation, devices: Object.freeze(devices)});
}
export function credentialPolicyBytes(value) {
  const p = checked(value);
  return new TextEncoder().encode(JSON.stringify([domain, p.group, p.owner, p.credential,
    p.revision.toString(), p.generation.toString(), p.devices]));
}
function decode(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 2048) throw fail();
  const parts = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  if (!Array.isArray(parts) || parts.length !== 7 || parts[0] !== domain
      || ![parts[4], parts[5]].every(value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value))) throw fail();
  const value = checked({group: parts[1], owner: parts[2], credential: parts[3],
    revision: BigInt(parts[4]), generation: BigInt(parts[5]), devices: parts[6]});
  const canonical = credentialPolicyBytes(value);
  if (canonical.length !== bytes.length || !canonical.every((v, i) => v === bytes[i])) throw fail();
  return value;
}

export async function verifyCredentialPolicy(bytes, signature, expected) {
  // All trust anchors and revision floors come from the enclosing local owner
  // policy. An incoming signed payload is never allowed to nominate its owner.
  if (!expected || !hex(expected.group, 32) || !hex(expected.owner, 32) || !hex(expected.credential, 16)
      || typeof expected.afterRevision !== 'bigint' || expected.afterRevision < 0n || expected.afterRevision > max
      || !counter(expected.minimumGeneration) || !(bytes instanceof Uint8Array)
      || bytes.length > 2048 || !(signature instanceof Uint8Array) || signature.length !== 64) throw fail();
  const binding = {...expected}, snapshot = bytes.slice(), proof = signature.slice();
  const value = decode(snapshot);
  if (value.group !== binding.group || value.owner !== binding.owner || value.credential !== binding.credential
      || value.revision <= binding.afterRevision || value.generation < binding.minimumGeneration) throw fail();
  const publicBytes = Uint8Array.from(binding.owner.match(/../g), v => parseInt(v, 16));
  const key = await crypto.subtle.importKey('raw', publicBytes, 'Ed25519', false, ['verify']);
  if (!await crypto.subtle.verify('Ed25519', key, proof, snapshot)) throw fail();
  return value;
}
