import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRelayHandshake} from './handshake.mjs';
import {createRelayPeerExchange} from './peer-exchange.mjs';
async function fixture(){
  const keys=await Promise.all([0,1].map(()=>crypto.subtle.generateKey('Ed25519',false,['sign','verify'])));
  const ids=await Promise.all(keys.map(async k=>new Uint8Array(await crypto.subtle.exportKey('raw',k.publicKey))));
  const group=crypto.getRandomValues(new Uint8Array(32)),packets=[[],[]],received=[[],[]],tasks=new Map();let next=0;
  const timers={setTimeout(fn){tasks.set(++next,fn);return next;},clearTimeout(id){tasks.delete(id);}};
  const peers=await Promise.all([0,1].map(async i=>createRelayPeerExchange({
    handshake:await createRelayHandshake({role:i?'answer':'offer',group,epoch:0n,local:ids[i],peer:ids[1-i],
      sign:async b=>new Uint8Array(await crypto.subtle.sign('Ed25519',keys[i].privateKey,b)),check:async()=>{}}),
    local:ids[i],peer:ids[1-i],timers,send:b=>packets[i].push(b),onMessage:b=>received[i].push([...b])})));
  const pump=async()=>{for(let turn=0;turn<100;turn++){for(let i=0;i<2;i++)for(const b of packets[i].splice(0))peers[1-i].receive(b);await new Promise(r=>setTimeout(r,2));}};
  const tick=()=>{const jobs=[...tasks.values()];tasks.clear();for(const fn of jobs)fn();};
  return {peers,packets,received,tasks,pump,tick};
}
test('staggered peers recover lost first contribution and duplicate confirmation',async()=>{
  const f=await fixture();try{
    f.peers[0].start();f.packets[0].length=0; // other browser not connected yet
    f.peers[1].start();await f.pump();f.tick();await f.pump();
    await Promise.all(f.peers.map(p=>p.ready));assert.equal(f.tasks.size,0);
    await f.peers[0].send(new Uint8Array([5,6]));await f.pump();assert.deepEqual(f.received[1],[[5,6]]);
    await f.peers[1].send(new Uint8Array([7]));await f.pump();assert.deepEqual(f.received[0],[[7]]);
  }finally{f.peers.forEach(p=>p.close());}
});
test('unrelated addressed traffic ignored and pending queue bounded',async()=>{
  const f=await fixture();try{
    f.peers[0].start();f.peers[1].start();const frame=f.packets[0][0];const unrelated=frame.slice();unrelated[41]^=1;
    for(let i=0;i<100;i++)f.peers[1].receive(unrelated);
    assert.equal(f.peers[1].signal.aborted,false);
    for(let i=0;i<33;i++)f.peers[1].receive(frame);
    assert.equal(f.peers[1].signal.aborted,true);await assert.rejects(f.peers[1].ready);
  }finally{f.peers.forEach(p=>p.close());}
});
test('lost confirmation is recovered without resetting encrypted sequence',async()=>{
  const f=await fixture();try{
    f.peers[0].start();f.peers[1].start();
    for(let i=0;i<2;i++)for(const packet of f.packets[i].splice(0))f.peers[1-i].receive(packet);
    for(let turn=0;turn<100&&!f.packets.every(list=>list.some(p=>p[8]===2));turn++)await new Promise(r=>setTimeout(r,2));
    const lost=f.packets[0].splice(0);assert.ok(lost.some(p=>p[8]===2));
    await f.pump();f.tick();await f.pump();await Promise.all(f.peers.map(p=>p.ready));
    for(const packet of lost)f.peers[1].receive(packet);await f.pump();
    assert.equal(f.peers[1].signal.aborted,false);
    await f.peers[0].send(new Uint8Array([9]));await f.pump();assert.deepEqual(f.received[1],[[9]]);
  }finally{f.peers.forEach(p=>p.close());}
});
