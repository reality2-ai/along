// Time-bounded duplicate suppression keyed on (origin, message identifier),
// L3 5.3. Records expire by age; capacity eviction drops the oldest first.
export function duplicateCache({lifetimeMs = 30_000, capacity = 1024, now = () => Date.now()} = {}) {
  const seen = new Map();
  const key = (origin, msgId) => Array.from(origin, b => b.toString(16).padStart(2, '0')).join('') + ':' + msgId;
  const prune = t => { for (const [k, at] of seen) { if (t - at < lifetimeMs) break; seen.delete(k); } };
  return {
    // True if new (and records it); false if a live duplicate.
    admit(origin, msgId) {
      const t = now(); prune(t);
      const k = key(origin, msgId);
      if (seen.has(k)) return false;
      seen.set(k, t);
      while (seen.size > capacity) seen.delete(seen.keys().next().value);
      return true;
    },
    get size() { return seen.size; },
  };
}
