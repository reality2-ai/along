import test from 'node:test';
import assert from 'node:assert/strict';
import {createAutomaticSignalling} from './automatic-signalling.mjs';
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
function channels() {
  const listeners = [undefined,undefined], sent=[];
  return {sent, endpoints:[0,1].map(i=>({
    send(text){sent.push(JSON.parse(text));queueMicrotask(()=>listeners[1-i]?.(text));},
    subscribe(fn){listeners[i]=fn;return ()=>{listeners[i]=undefined;};},close(){},
  })), inject(i, value){listeners[i]?.(JSON.stringify(value));}};
}
function session(role, log) {return {
  async offer(){log.push('offer');return {type:'offer',sdp:'synthetic-offer'};},
  async accept(value){log.push(role+':'+value.type);return {type:'answer',sdp:'synthetic-answer'};},
  async cancel(){log.push(role+':cancel');},
};}
test('one reviewed invitation carries proof and both connection messages automatically',async()=>{
 const c=channels(),log=[],ready=[],errors=[];
 const p=createAutomaticSignalling({role:'provisioner',channel:c.endpoints[0],answerProof:async value=>{assert.equal(value,'challenge');log.push('proof');return 'signed-proof';},createSession:async()=>session('p',log),onSession:s=>ready.push(s),onError:e=>errors.push(e)});
 const a=createAutomaticSignalling({role:'candidate',channel:c.endpoints[1],verifyProof:async value=>{assert.equal(value,'signed-proof');log.push('verified');return {verified:true};},createSession:async proof=>{assert.deepEqual(proof,{verified:true});return session('c',log);},onSession:s=>ready.push(s),onError:e=>errors.push(e)});
 await a.start('challenge');await tick();
 assert.equal(ready.length,2);assert.deepEqual(errors,[]);
 assert.deepEqual(c.sent.map(v=>v.kind),['challenge','proof','offer','answer']);
 assert.deepEqual(log,['proof','verified','offer','p:offer','c:answer']);
 assert.equal(a.phase,'ready');assert.equal(p.phase,'ready');p.close();a.close();
});
test('failed invitation proof never creates a candidate session',async()=>{
 const c=channels();let made=0,failed=0;
 const a=createAutomaticSignalling({role:'candidate',channel:c.endpoints[1],verifyProof:()=>{throw Error('bad proof');},createSession:()=>{made++;},onError:()=>failed++});
 await a.start('challenge');c.inject(1,{profile:'along-enrollment-signalling-v1',kind:'proof',body:'forged'});await tick();
 assert.equal(made,0);assert.equal(failed,1);assert.equal(a.phase,'closed');
});
test('out-of-order and oversized messages close before any enrollment action',async()=>{
 for(const body of ['wrong-order','x'.repeat(65537)]){
  const c=channels();let calls=0;
  const p=createAutomaticSignalling({role:'provisioner',channel:c.endpoints[0],answerProof:()=>{calls++;},createSession:()=>{calls++;}});
  c.inject(0,{profile:'along-enrollment-signalling-v1',kind:'answer',body});await tick();
  assert.equal(calls,0);assert.equal(p.phase,'closed');
 }
});
test('cancellation during session creation disposes the late session and sends no reply',async()=>{
 const c=channels(),abort=new AbortController();let resolve, cancelled=0,ready=0;
 const p=createAutomaticSignalling({role:'provisioner',channel:c.endpoints[0],signal:abort.signal,answerProof:async()=> 'proof',createSession:()=>new Promise(r=>{resolve=r;}),onSession:()=>ready++});
 c.inject(0,{profile:'along-enrollment-signalling-v1',kind:'challenge',body:'challenge'});await tick();abort.abort();
 resolve({cancel:async()=>{cancelled++;}});await tick();
 assert.equal(cancelled,1);assert.equal(ready,0);assert.equal(c.sent.length,0);assert.equal(p.phase,'closed');
});
