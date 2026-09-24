// Notekeeper / r2-relay v1 routing greeting. This proves possession of a
// device signing key, NOT membership of the advertised group or peer consent.
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
export async function createRelayHello({persona, expectedGroup, timestamp = Math.floor(Date.now() / 1000), signal}) {
  const current = () => { if (signal?.aborted) throw Error('Relay greeting cancelled'); };
  current();
  if (!(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32
      || !Number.isSafeInteger(timestamp) || timestamp < 0 || !persona
      || typeof persona.sign !== 'function' || !/^[0-9a-f]{64}$/.test(persona.member)
      || persona.group !== hex(expectedGroup)) throw Error('Relay identity unavailable');
  const group = expectedGroup.slice(), member = persona.member, sign = persona.sign.bind(persona);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', group)); current();
  const trust_group = hex(digest.slice(0, 8));
  const message = new TextEncoder().encode(`${trust_group}:${member}:${timestamp}`);
  const signature = await sign(message.slice()); current();
  if (!(signature instanceof Uint8Array) || signature.length !== 64) throw Error('Relay signature unavailable');
  const proof = signature.slice();
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(member.match(/../g), b => parseInt(b, 16)), 'Ed25519', false, ['verify']);
  if (!await crypto.subtle.verify('Ed25519', key, proof, message)) throw Error('Relay signature invalid');
  current();
  return JSON.stringify({type:'hello', version:1, trust_group, device_id:member, timestamp, signature:hex(proof)});
}
