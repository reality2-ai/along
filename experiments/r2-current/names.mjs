// Event identifier hashing, current R2 L4 7.1 (FNV-1a 32 over the normalised
// UTF-8 name). Hive and group wire identifiers are not names (7.1.4).

const TRIM = new Set([0x20, 0x85, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000]);
const trimmed = cp => (cp >= 0x09 && cp <= 0x0d) || (cp >= 0x2000 && cp <= 0x200a) || TRIM.has(cp);

function fold(cp) {
  if (cp >= 0x41 && cp <= 0x5a) return cp + 0x20;
  if (cp >= 0xc0 && cp <= 0xde && cp !== 0xd7) return cp + 0x20;
  if (((cp >= 0x100 && cp <= 0x137) || (cp >= 0x14a && cp <= 0x177)) && cp % 2 === 0) return cp + 1;
  if (((cp >= 0x139 && cp <= 0x148) || (cp >= 0x179 && cp <= 0x17e)) && cp % 2 === 1) return cp + 1;
  if (cp === 0x178) return 0xff;
  return cp;
}

export function normaliseName(name) {
  const cps = [...String(name)].map(c => c.codePointAt(0));
  let start = 0, end = cps.length;
  while (start < end && trimmed(cps[start])) start++;
  while (end > start && trimmed(cps[end - 1])) end--;
  return String.fromCodePoint(...cps.slice(start, end).map(fold));
}

export function eventHash(name) {
  const normal = normaliseName(name);
  if (!normal) throw new Error('An empty name is not an event identifier');
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(normal)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  if (hash === 0xffffffff) throw new Error('Reserved event identifier hash');
  return hash;
}
