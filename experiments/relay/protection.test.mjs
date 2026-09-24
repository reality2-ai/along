import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRelayProtection} from './protection.mjs';
async function fixture(overrides={}){
  const keys=await Promise.all([0,1].map(()=>crypto.subtle.generateKey('Ed25519',false,['sign','verify'])));
  const ids=await Promise.all(keys.map(async k=>new Uint8Array(await crypto.subtle.exportKey('raw',k.publicKey))));
  const shared={sessionSecret:crypto.getRandomValues(new Uint8Array(32)),group:crypto.getRandomValues(new Uint8Array(32)),epoch:0n,transcript:crypto.getRandomValues(new Uint8Array(32)),check:async()=>{}};
  const make=(i,extra={})=>createRelayProtection({...shared,local:ids[i],peer:ids[1-i],sign:async b=>new Uint8Array(await crypto.subtle.sign('Ed25519',keys[i].privateKey,b)),...extra});
  return {a:await make(0,overrides),b:await make(1),make};
}
test('bounded encrypted bidirectional messages; strict replay closes session',async()=>{
  const {a,b}=await fixture();const text=new TextEncoder().encode('synthetic saved places');const packet=await a.seal(text);
  assert.equal(new TextDecoder().decode(packet).includes('synthetic saved places'),false);
  assert.deepEqual(await b.open(packet),text);assert.deepEqual(await a.open(await b.seal(new Uint8Array([4]))),new Uint8Array([4]));
  await assert.rejects(b.open(packet));await assert.rejects(b.seal(text));a.close();
});
test('different epoch, transcript, direction, key, or signature refuses',async()=>{
  for(const kind of ['epoch','transcript','key','signature','direction']){
    const {a,b,make}=await fixture();const packet=await a.seal(new Uint8Array([1,2,3]));let receiver=b;
    if(kind==='epoch')receiver=await make(1,{epoch:1n});
    if(kind==='transcript')receiver=await make(1,{transcript:crypto.getRandomValues(new Uint8Array(32))});
    if(kind==='key')receiver=await make(1,{sessionSecret:crypto.getRandomValues(new Uint8Array(32))});
    if(kind==='signature')packet[packet.length-1]^=1;
    if(kind==='direction')receiver=a;
    await assert.rejects(receiver.open(packet));a.close();b.close();receiver.close();
  }
});
test('permission loss during signing prevents outgoing packet',async()=>{
  let allowed=true;const {a,b}=await fixture({check:async()=>{if(!allowed)throw Error('Permission removed');},sign:async()=>{allowed=false;return new Uint8Array(64);}});
  await assert.rejects(a.seal(new Uint8Array([1])));await assert.rejects(a.seal(new Uint8Array([1])));b.close();
});
test('out of order and oversized input refused',async()=>{
  const {a,b}=await fixture();await a.seal(new Uint8Array([1]));const second=await a.seal(new Uint8Array([2]));
  await assert.rejects(b.open(second));await assert.rejects(a.seal(new Uint8Array(2049)));
});
test('caller mutation during asynchronous checks cannot change payload',async()=>{
  let release,hold=false;
  const {a,b}=await fixture({check:async()=>{if(hold)await new Promise(r=>{release=r;});}});
  hold=true;const input=new Uint8Array([3,4]);const pending=a.seal(input);input.fill(9);
  await new Promise(r=>setTimeout(r,0));hold=false;release();
  const packet=await pending;assert.deepEqual(await b.open(packet),new Uint8Array([3,4]));a.close();b.close();
});
