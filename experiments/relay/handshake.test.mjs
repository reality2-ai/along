import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRelayHandshake} from './handshake.mjs';
async function fixture(){
  const keys=await Promise.all([0,1].map(()=>crypto.subtle.generateKey('Ed25519',false,['sign','verify'])));
  const ids=await Promise.all(keys.map(async k=>new Uint8Array(await crypto.subtle.exportKey('raw',k.publicKey))));
  const group=crypto.getRandomValues(new Uint8Array(32));
  const make=(i,extra={})=>createRelayHandshake({role:i?'answer':'offer',group,epoch:0n,local:ids[i],peer:ids[1-i],
    sign:async b=>new Uint8Array(await crypto.subtle.sign('Ed25519',keys[i].privateKey,b)),check:async()=>{},...extra});
  return {a:await make(0),b:await make(1),make};
}
test('signed contributions and mutual key confirmation allow encrypted exchange',async()=>{
  const {a,b}=await fixture();try{
    const [offer,answer]=await Promise.all([a.contribution(),b.contribution()]);
    const [ac,bc]=await Promise.all([a.accept(answer),b.accept(offer)]);
    const [left,right]=await Promise.all([a.confirm(bc),b.confirm(ac)]);
    assert.deepEqual(await right.open(await left.seal(new Uint8Array([1,2]))),new Uint8Array([1,2]));
    assert.deepEqual(await left.open(await right.seal(new Uint8Array([3]))),new Uint8Array([3]));
    const replay=await left.seal(new Uint8Array([4]));await right.open(replay);
    await assert.rejects(right.open(replay));assert.equal(right.signal.aborted,true);
  }finally{a.close();b.close();}
});
test('altered contribution, wrong epoch, reflection and premature confirmation refuse',async()=>{
  for(const kind of ['altered','epoch','reflection','premature']){
    const {a,b,make}=await fixture();let remote=b;
    try{
      if(kind==='epoch')remote=await make(1,{epoch:1n});
      const offer=await a.contribution(),answer=await remote.contribution();
      if(kind==='altered')answer[40]^=1;
      await assert.rejects(kind==='premature'?a.confirm(answer):a.accept(kind==='reflection'?offer:answer));
      assert.equal(a.signal.aborted,true);
    }finally{a.close();b.close();remote.close();}
  }
});
test('old signed contribution cannot authenticate a fresh session with old confirmation',async()=>{
  const {a,b,make}=await fixture();let fresh;
  try{
    const offer=await a.contribution(),answer=await b.contribution();
    const oldConfirmation=await b.accept(offer);await a.accept(answer);
    fresh=await make(0);await fresh.contribution();await fresh.accept(answer);
    await assert.rejects(fresh.confirm(oldConfirmation));assert.equal(fresh.signal.aborted,true);
  }finally{a.close();b.close();fresh?.close();}
});
test('permission loss and cancellation end pending handshakes',async()=>{
  const {a,b,make}=await fixture();let guarded,cancelled;let allowed=true;
  try{
    guarded=await make(0,{check:async()=>{if(!allowed)throw Error('Permission removed');}});
    await guarded.contribution();const answer=await b.contribution();allowed=false;
    await assert.rejects(guarded.accept(answer));
    const controller=new AbortController();cancelled=await make(0,{signal:controller.signal});controller.abort();
    await assert.rejects(cancelled.contribution());assert.equal(cancelled.signal.aborted,true);
  }finally{a.close();b.close();guarded?.close();cancelled?.close();}
});
