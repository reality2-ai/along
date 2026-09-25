import test from 'node:test';
import assert from 'node:assert/strict';
import {createHiveRelayTransportFactory} from './hive-relay-transport.mjs';
import {reassembler, segment, MAX_PIECES} from './segments.mjs';
import {MAX_PLAINTEXT} from './group-protection.mjs';
import {parseFrame} from './frame.mjs';

const pause = ms => new Promise(r => setTimeout(r, ms));
const range = (from, n) => Uint8Array.from({length: n}, (_, i) => (from + i) & 0xff);
const hex = b => Array.from(b, v => v.toString(16).padStart(2, '0')).join('');

test('segments reassemble in any order and reject inconsistent pieces', () => {
  const packet = range(3, 2286);
  const pieces = segment(packet, 77, MAX_PLAINTEXT);
  assert.ok(pieces.every(p => p.length <= MAX_PLAINTEXT));
  assert.equal(pieces.length, Math.ceil(2286 / (MAX_PLAINTEXT - 13)));
  const r = reassembler();
  const order = pieces.map((_, i) => i).reverse();
  let out = null;
  for (const i of order) { const got = r.accept('o', pieces[i]); if (got) out = got; }
  assert.deepEqual(out, packet);
  assert.equal(r.size, 0);
  assert.equal(r.accept('o', Uint8Array.of(0xff)), null);
  assert.deepEqual(reassembler().accept('o', segment(Uint8Array.of(9), 1, MAX_PLAINTEXT)[0]), Uint8Array.of(9));
  assert.throws(() => segment(new Uint8Array(MAX_PIECES * 147 + 1), 1, MAX_PLAINTEXT));
  let t = 0; const aged = reassembler({now: () => t, lifetimeMs: 100});
  aged.accept('o', pieces[0]); t = 100; aged.accept('p', pieces[0]);
  assert.equal(aged.size, 1);
});

// In-memory hive: forwards each binary frame to every other socket with the
// relay's permitted mutations (hop decrement, budget halving, route append).
function network() {
  const sockets = [];
  class Socket {
    constructor(url, protocol) {
      this.protocol = protocol; this.bufferedAmount = 0; this.sent = [];
      sockets.push(this); setTimeout(() => this.onopen?.(), 0);
    }
    send(bytes) {
      this.sent.push(bytes);
      const f = parseFrame(bytes);
      if (f.discard || f.hop < 2 || (f.budget >> 1) === 0 || f.payload.length > 200) return;
      const out = new Uint8Array(bytes.length + 8);
      out.set(bytes.subarray(0, 23 + 8 * f.route.length));
      out[1] = ((f.hop - 1) << 4) | (f.budget >> 1); out[22] = f.route.length + 1;
      out.set(range(200, 8), 23 + 8 * f.route.length); out.set(bytes.subarray(23 + 8 * f.route.length), 31 + 8 * f.route.length);
      for (const s of sockets) if (s !== this && !s.closed) setTimeout(() => s.onmessage?.({data: out.buffer}), 0);
    }
    close() { this.closed = true; }
  }
  return {Socket, sockets};
}

const group = range(1, 32);
function device(net, subject, keys, received, statuses) {
  let revision = 1;
  const records=new Map();
  const store = {read:async(scope,key)=>scope==='membership'?{revision}:structuredClone(records.get(key)??null),
    compareAndSwapMany:async([change])=>{const before=records.get(change.key);if((before?.revision??0)!==change.expectedRevision)return {applied:false};records.set(change.key,{revision:change.expectedRevision+1,value:structuredClone(change.value)});return {applied:true};}};
  const factory = createHiveRelayTransportFactory({wasm: null, store, expectedGroup: group, member: hex(subject),
    WebSocket: net.Socket, loadTraffic: async () => ({...keys(), destroy() {}})});
  const t = factory({url: 'wss://hive.example/r2', onFrame: p => received.push(p), onStatus: s => statuses.push(s)});
  return {t, rotate() { revision++; }};
}
const relayPacket = (from, to, n) => {
  const p = new Uint8Array(137 + n); p.set(new TextEncoder().encode('ALNRLY01')); p[8] = 3; p.set(from, 9); p.set(to, 41); p.set(range(9, n), 137);
  return p;
};

test('discovery reaches the group; addressed packets reach only their peer; own frames are not echoed', async () => {
  const net = network();
  const keys = {epoch: 0n, payloadKey: range(50, 32), integrityKey: range(90, 32)};
  const A = range(10, 32), B = range(20, 32), C = range(30, 32);
  const got = {a: [], b: [], c: []}, st = {a: [], b: [], c: []};
  const a = device(net, A, () => keys, got.a, st.a), b = device(net, B, () => keys, got.b, st.b), c = device(net, C, () => keys, got.c, st.c);
  for (const d of [a, b, c]) d.t.start();
  await pause(30);
  assert.deepEqual([st.a.at(-1), st.b.at(-1), st.c.at(-1)], ['connected', 'connected', 'connected']);
  const discovery = new Uint8Array(304); discovery.set(new TextEncoder().encode('ALNRDS01')); discovery.set(range(7, 296), 8);
  a.t.send(discovery);
  const toB = relayPacket(A, B, 2149);
  a.t.send(toB);
  await pause(1500);
  assert.deepEqual(got.b, [discovery, toB]);
  assert.deepEqual(got.c, [discovery]);
  assert.deepEqual(got.a, []);
  // Every frame on the wire is group-protected and within the relay payload limit.
  const frames = net.sockets[0].sent.map(x => parseFrame(x)).filter(f => f.type === 0);
  assert.ok(frames.length > 16);
  assert.ok(frames.every(f => f.tag && f.payload.length <= 200));
  for (const d of [a, b, c]) d.t.disconnect();
});

test('a device without the current group keys receives nothing; prior keys cover a rotation briefly', async () => {
  const net = network();
  let keysA = {epoch: 0n, payloadKey: range(50, 32), integrityKey: range(90, 32)};
  const stranger = {epoch: 0n, payloadKey: range(1, 32), integrityKey: range(2, 32)};
  let keysB = keysA;
  const A = range(10, 32), B = range(20, 32), S = range(40, 32);
  const got = {a: [], b: [], s: []};
  const a = device(net, A, () => keysA, got.a, []), b = device(net, B, () => keysB, got.b, []), s = device(net, S, () => stranger, got.s, []);
  for (const d of [a, b, s]) d.t.start();
  await pause(30);
  const packet = relayPacket(A, B, 40);
  a.t.send(packet); await pause(100);
  assert.equal(got.b.length, 1); assert.equal(got.s.length, 0);
  // B installs epoch 1 first; A's in-flight epoch-0 traffic is still admitted.
  keysB = {epoch: 1n, payloadKey: range(120, 32), integrityKey: range(160, 32)}; b.rotate();
  a.t.send(relayPacket(A, B, 41)); await pause(100);
  assert.equal(got.b.length, 2);
  keysA = keysB; a.rotate();
  a.t.send(relayPacket(A, B, 42)); await pause(100);
  assert.equal(got.b.length, 3);
  assert.equal(got.s.length, 0);
  for (const d of [a, b, s]) d.t.disconnect();
});

test('bootstrap segmentation extends the bound explicitly without changing sharing defaults', () => {
  const packet = range(7, 16384), limits = {maxPacket:16384,maxPieces:128};
  assert.throws(() => segment(packet,9,MAX_PLAINTEXT));
  const pieces = segment(packet,9,MAX_PLAINTEXT,limits);
  assert.ok(pieces.every(p => p.length <= MAX_PLAINTEXT));
  const normal = reassembler(), bootstrap = reassembler(limits);
  let restored;
  for (const piece of pieces) {
    assert.equal(normal.accept('test',piece),null);
    restored = bootstrap.accept('test',piece) ?? restored;
  }
  assert.deepEqual(restored,packet);
  bootstrap.accept('test',pieces[0]);assert.equal(bootstrap.size,1);
  bootstrap.clear();assert.equal(bootstrap.size,0);
});
