// Measures how many group-protected frames the deployed hive relays from one
// origin: N frames at a fixed gap, with an optional pause after the 64th, then
// one frame from a fresh origin as a control. Synthetic keys; no user data.
// Usage: node experiments/r2-current/rate-check.mjs [frames] [gapMs] [pauseMs] [evidence.json]
import {writeFileSync} from 'node:fs';
import {protectEvent, wireEntry} from './group-protection.mjs';
import {parseFrame} from './frame.mjs';
import {heartbeatFrame} from './heartbeat.mjs';

const [N = 70, gap = 160, pauseAfter64 = 0] = process.argv.slice(2, 5).map(Number);
const out = process.argv[5], url = 'wss://wairoa.mariko.org.nz/r2';
const r = n => crypto.getRandomValues(new Uint8Array(n)), pause = ms => new Promise(x => setTimeout(x, ms));
const group = r(32), keys = {payloadKey: r(32), integrityKey: r(32)};
const open = async () => {
  const s = new WebSocket(url, 'r2.extended.v1'); s.binaryType = 'arraybuffer'; s.got = new Set();
  s.onmessage = ({data}) => { const f = parseFrame(new Uint8Array(data)); if (!f.discard && f.type === 0) s.got.add(f.msgId); };
  await new Promise(x => { s.onopen = x; }); return s;
};
const a = await open(), b = await open();
const A = await wireEntry(group, r(32)), B = await wireEntry(group, r(32)), fresh = await wireEntry(group, r(32));
const announce = (s, o) => s.send(heartbeatFrame({origin: o, msgId: crypto.getRandomValues(new Uint32Array(1))[0], beaconId: r(4), classHash: r(4)}));
const timers = [setInterval(() => announce(a, A), 2000), setInterval(() => announce(b, B), 2000)];
announce(a, A); announce(b, B); await pause(500);
const target = new Uint8Array(8); target.set(A.subarray(0, 4)); target.set(B.subarray(4), 4);
const started = Date.now(); const sentAt = [];
for (let i = 0; i < N; i++) {
  if (pauseAfter64 && i === 64) await pause(pauseAfter64);
  sentAt.push(Date.now() - started);
  a.send(await protectEvent({keys, origin: A, target, eventHash: 1234, plaintext: r(160), msgId: 1000 + i}));
  await pause(gap);
}
a.send(await protectEvent({keys, origin: fresh, target, eventHash: 1234, plaintext: r(160), msgId: 999}));
await pause(2000);
timers.forEach(clearInterval);
const missing = []; for (let i = 0; i < N; i++) if (!b.got.has(1000 + i)) missing.push(i);
const result = {checked_at: new Date().toISOString(), url, frames: N, gap_ms: gap, pause_after_64_ms: pauseAfter64,
  delivered: N - missing.length, first_missing_index: missing[0] ?? null,
  first_missing_sent_at_ms: missing.length ? sentAt[missing[0]] : null,
  fresh_origin_control_delivered: b.got.has(999),
  scope: 'Relay of 200-byte protected payloads from one synthetic origin through the deployed hive, observed by a second connection. Measures observed forwarding only.'};
console.log(JSON.stringify(result, null, 2));
if (out) writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
process.exit(0);
