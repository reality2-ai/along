// Notifications are hints to re-read local state, never authority to advance it.
const listeners = new Map();
const fixed = (v, n) => v instanceof Uint8Array && v.length === n;
const hex = v => Array.from(v, b => b.toString(16).padStart(2, '0')).join('');
const same = (a, b) => fixed(a, b.length) && a.every((v, i) => v === b[i]);
const hint = 'check-local-epoch-v1';

export function watchLocalEpoch({store, group, subject, epoch, onChange}) {
  if (!fixed(group, 32) || !fixed(subject, 32) || typeof epoch !== 'bigint'
      || typeof onChange !== 'function') throw Error('Epoch watch unavailable');
  group = group.slice(); subject = subject.slice();
  const key = hex(group), channel = typeof BroadcastChannel === 'function'
    ? new BroadcastChannel('along-epoch:' + key) : null;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true; channel?.close();
    listeners.get(key)?.delete(check);
    if (!listeners.get(key)?.size) listeners.delete(key);
    globalThis.removeEventListener?.('pageshow', wake);
    globalThis.removeEventListener?.('focus', wake);
    globalThis.document?.removeEventListener('visibilitychange', wake);
  };
  const changed = () => { if (!closed) { close(); try { onChange(); } catch {} } };
  const check = async () => {
    if (closed) return false;
    try {
      const membership = await store.read('membership', key);
      const persona = await store.read('candidate-persona', 'active');
      if (closed) return false;
      if (membership?.value?.current !== epoch || persona?.value?.epoch !== epoch
          || !same(membership.value.group, group) || !same(membership.value.subject, subject)
          || !same(persona.value.record?.group, group) || !same(persona.value.record?.subject, subject)) {
        changed(); return false;
      }
      return true;
    } catch { changed(); return false; }
  };
  const wake = () => { void check(); };
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(check);
  if (channel) channel.onmessage = event => { if (event.data === hint) wake(); };
  globalThis.addEventListener?.('pageshow', wake);
  globalThis.addEventListener?.('focus', wake);
  globalThis.document?.addEventListener('visibilitychange', wake);
  return Object.freeze({check, close});
}

// Called only after a successful installation commit. A wake-up failure cannot
// undo that commit; packet-level membership checks remain mandatory.
export async function announceEpochChange(group) {
  if (!fixed(group, 32)) throw Error('Epoch notification unavailable');
  const key = hex(group);
  await Promise.allSettled([...(listeners.get(key) || [])].map(check => check()));
  if (typeof BroadcastChannel === 'function') {
    const channel = new BroadcastChannel('along-epoch:' + key);
    try { channel.postMessage(hint); } finally { channel.close(); }
  }
}
