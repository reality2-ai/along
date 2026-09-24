import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRelayTransport, relayEndpoint} from './transport.mjs';
function fixture(createHello = async () => '{"type":"hello"}') {
  const tasks = new Map(), sockets = [], statuses = [], frames = []; let seq = 0;
  const timers = {setTimeout(fn, ms) { tasks.set(++seq, {fn, ms}); return seq; }, clearTimeout(id) { tasks.delete(id); }};
  class Socket {
    constructor() { sockets.push(this); this.bufferedAmount = 0; this.sent = []; }
    send(value) { this.sent.push(value); }
    close() { this.closed = true; }
  }
  const transport = createRelayTransport({url:'wss://relay.example/r2', createHello, WebSocket:Socket, timers, random:()=>0,
    onStatus:s=>statuses.push(s), onFrame:f=>frames.push(f)});
  const tick = ms => { const pair = [...tasks].find(([,v])=>v.ms===ms); assert.ok(pair, `timer ${ms}`); tasks.delete(pair[0]); pair[1].fn(); };
  const welcome = async () => { const s=sockets.at(-1); await s.onopen(); s.onmessage({data:'{"type":"welcome","peers":1}'}); return s; };
  return {transport,tasks,sockets,statuses,frames,tick,welcome};
}
test('endpoint requires explicit secure URL without embedded secrets',()=>{
  for (const url of ['ws://relay.example/r2','https://relay.example/r2','wss://u:p@relay.example/r2','wss://relay.example/r2?key=x','wss://relay.example/r2#x',' wss://relay.example']) assert.throws(()=>relayEndpoint(url));
  assert.equal(relayEndpoint('wss://relay.example/r2'),'wss://relay.example/r2');
});
test('explicit start, handshake, frame bounds and heartbeat timeout',async()=>{
  const f=fixture(); assert.equal(f.sockets.length,0); f.transport.start(); const s=await f.welcome();
  f.transport.send(new Uint8Array([1])); s.onmessage({data:new Uint8Array([2]).buffer}); assert.deepEqual([...f.frames[0]],[2]);
  assert.throws(()=>f.transport.send(new Uint8Array(65537)));
  f.tick(30000); s.onmessage({data:'{"type":"pong"}'}); f.tick(30000); f.tick(10000);
  assert.equal(f.statuses.at(-1),'waiting'); assert.equal(s.closed,true);
  f.tick(800); assert.equal(f.sockets.length,2); f.transport.disconnect(); assert.equal(f.tasks.size,0);
});
test('disconnect cancels retry and late greeting cannot send',async()=>{
  let resolve; const f=fixture(()=>new Promise(r=>resolve=r)); f.transport.start(); const s=f.sockets[0]; const pending=s.onopen();
  f.transport.disconnect(); resolve('hello'); await pending; assert.equal(s.sent.length,0); assert.equal(f.tasks.size,0);
  f.transport.start(); f.sockets.at(-1).onerror(); assert.equal(f.tasks.size,1); f.transport.disconnect(); assert.equal(f.tasks.size,0);
});
test('pre-auth frame and unauthorized close stop without reconnect',async()=>{
  const f=fixture(); f.transport.start(); f.sockets[0].onmessage({data:new Uint8Array([1]).buffer});
  assert.equal(f.frames.length,0); assert.equal(f.statuses.at(-1),'refused'); assert.equal(f.tasks.size,0);
  f.transport.start(); await f.welcome(); f.sockets.at(-1).onclose({code:4403}); assert.equal(f.tasks.size,0); assert.equal(f.statuses.at(-1),'refused');
});
test('welcome before greeting completion is refused',async()=>{
  const f=fixture(); f.transport.start(); f.sockets[0].onmessage({data:'{"type":"welcome","peers":1}'});
  assert.equal(f.statuses.at(-1),'refused');
});
test('status observer may disconnect without leaving socket or retry',()=>{
  let transport, constructed=0; const tasks=new Map();
  transport=createRelayTransport({url:'wss://relay.example/r2', createHello:async()=>'',onFrame:()=>{},
    WebSocket:class{constructor(){constructed++;}},
    timers:{setTimeout(fn){tasks.set(1,fn);return 1;},clearTimeout(id){tasks.delete(id);}},
    onStatus:state=>{if(state==='connecting')transport.disconnect();}});
  transport.start(); assert.equal(constructed,0); assert.equal(tasks.size,0);
});
