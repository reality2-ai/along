// Along's experimental enrollment carriage, not a normative R2 bundle format.
// Opaque, volatile keys; one claim, bundle, installed receipt and acknowledgment per exchange. No admission.
const encoder = new TextEncoder();
const MAX = 2048;
const kinds = ['claim', 'bundle', 'installed', 'acknowledged'];
const fromCandidate = kind => kind === 'claim' || kind === 'installed';
export async function createEnrollmentProtection(material, statement, transcript, role, requireCurrent) {
  if (!['candidate', 'provisioner'].includes(role) || typeof requireCurrent !== 'function'
      || !(statement instanceof Uint8Array) || statement.length !== 89
      || !(transcript instanceof Uint8Array) || transcript.length !== 32) throw new TypeError('Invalid protection context');
  const context = new Uint8Array(121); context.set(statement); context.set(transcript, 89);
  let keys = {}, closed = false;
  const used = new Set();
  const close = () => { closed = true; keys = null; };
  const current = () => { if (closed) throw new Error('Enrollment protection closed'); requireCurrent(); };
  const aad = kind => {
    const domain = encoder.encode('along/enrollment/' + kind + '/v1\0');
    const result = new Uint8Array(domain.length + context.length); result.set(domain); result.set(context, domain.length); return result;
  };
  for (const kind of kinds) {
    const operation = fromCandidate(kind) === (role === 'candidate') ? 'encrypt' : 'decrypt';
    keys[kind] = await crypto.subtle.deriveKey({name: 'HKDF', hash: 'SHA-256', salt: context.subarray(89), info: aad(kind)},
      material, {name: 'AES-GCM', length: 256}, false, [operation]);
  }
  const run = async (operation, kind, value) => {
    let input, output;
    try {
      current();
      const sending = fromCandidate(kind) === (role === 'candidate');
      if (!kinds.includes(kind) || sending !== (operation === 'encrypt') || used.has(kind)
          || !(value instanceof Uint8Array) || value.length < (sending ? 1 : 29)
          || value.length > MAX + (sending ? 0 : 28)) throw new Error('Invalid or reused enrollment payload');
      used.add(kind); input = value.slice();
      const iv = sending ? crypto.getRandomValues(new Uint8Array(12)) : input.slice(0, 12);
      output = new Uint8Array(await crypto.subtle[operation]({name: 'AES-GCM', iv, additionalData: aad(kind), tagLength: 128},
        keys[kind], sending ? input : input.subarray(12)));
      current();
      if (!sending) return output;
      const packet = new Uint8Array(12 + output.length); packet.set(iv); packet.set(output, 12); return packet;
    } catch (error) { output?.fill(0); close(); throw error; }
    finally { input?.fill(0); }
  };
  return Object.freeze({seal: (kind, value) => run('encrypt', kind, value), open: (kind, value) => run('decrypt', kind, value), close});
}
