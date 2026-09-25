import test from 'node:test';
import assert from 'node:assert/strict';
import {createHiveTransport, SUBPROTOCOL} from './transport.mjs';

function fixture({protocol = SUBPROTOCOL} = {}) {
  const tasks = new Map(), sockets = [], statuses = [], frames = []; let seq = 0, t = 0, beats = 0;
  const timers = {setTimeout(fn, ms) { tasks.set(++seq, {fn, ms}); return seq; }, clearTimeout(id) { tasks.delete(id); }};
  class Socket {
    constructor(url, proto) { this.url = url; this.requested = proto; sockets.push(this); this.bufferedAmount = 0; this.sent = []; }
    send(value) { this.sent.push(value); }
    close() { this.closed = true; }
  }
  const transport = createHiveTransport({url: 'wss://hive.example/r2', WebSocket: Socket, timers, random: () => 1, now: () => t,
    announce: () => { beats++; return Uint8Array.of(0x2c, beats); }, onStatus: s => statuses.push(s), onFrame: f => frames.push(f)});
  const tick = ms => { const pair = [...tasks].find(([, v]) => v.ms === ms); assert.ok(pair, `timer ${ms}`); tasks.delete(pair[0]); pair[1].fn(); };
  const open = () => { const s = sockets.at(-1); s.protocol = protocol; s.onopen(); return s; };
  return {transport, tasks, sockets, statuses, frames, tick, open, advance: ms => { t += ms; }};
}

test('requests the binding subprotocol, announces on open and every two seconds', () => {
  const f = fixture(); f.transport.start();
  assert.equal(f.sockets[0].requested, 'r2.extended.v1');
  const s = f.open();
  assert.equal(f.statuses.at(-1), 'connected');
  assert.equal(s.sent.length, 1);
  f.tick(2000); assert.equal(s.sent.length, 2);
  s.onmessage({data: Uint8Array.of(4, 1).buffer});
  assert.deepEqual([...f.frames[0]], [4, 1]);
  f.transport.stop(); assert.equal(f.tasks.size, 0); assert.equal(s.closed, true);
});

test('a server that does not select the subprotocol is refused without retry', () => {
  const f = fixture({protocol: ''}); f.transport.start(); f.open();
  assert.equal(f.statuses.at(-1), 'refused'); assert.equal(f.tasks.size, 0);
});

test('text, empty and oversize messages drop the connection; retry stays within ten seconds', () => {
  const f = fixture(); f.transport.start();
  for (const data of ['hello', new ArrayBuffer(0), new ArrayBuffer(65536)]) {
    const s = f.open(); s.onmessage({data});
    assert.equal(f.statuses.at(-1), 'waiting'); assert.equal(s.closed, true);
    const retry = [...f.tasks.values()].find(v => v.fn.name === 'connect' || v.ms <= 10000);
    assert.ok(retry.ms <= 10000); retry.fn();
  }
  for (let i = 0; i < 8; i++) { f.sockets.at(-1).onerror(); const [, r] = [...f.tasks].at(-1); assert.ok(r.ms <= 10000); f.tasks.clear(); r.fn(); }
});

test('thirty seconds of silence is a lost connection', () => {
  const f = fixture(); f.transport.start(); const s = f.open();
  f.tick(30000);
  assert.equal(f.statuses.at(-1), 'waiting'); assert.equal(s.closed, true);
});

test('sending is bounded by rate, size, readiness and buffered output', () => {
  const f = fixture(); f.transport.start();
  assert.equal(f.transport.send(Uint8Array.of(1)), false);
  const s = f.open();
  let accepted = 0; for (let i = 0; i < 40; i++) if (f.transport.send(Uint8Array.of(i))) accepted++;
  assert.equal(accepted, 31); // one slot already used by the opening announcement
  f.advance(1000); assert.equal(f.transport.send(Uint8Array.of(1)), true);
  assert.equal(f.transport.send(new Uint8Array(65536)), false);
  s.bufferedAmount = 8 * 65567; assert.equal(f.transport.send(Uint8Array.of(1)), false);
});
