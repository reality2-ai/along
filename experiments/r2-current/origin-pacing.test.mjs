import test from 'node:test';
import assert from 'node:assert/strict';
import {createOriginPacer} from './origin-pacing.mjs';
function memory() {
  const records=new Map();
  return {records,read:async(scope,key)=>structuredClone(records.get(scope+key)??null),
    async compareAndSwapMany([change]) {
      const key=change.scope+change.key,before=records.get(key);
      if((before?.revision??0)!==change.expectedRevision)return {applied:false};
      records.set(key,{revision:change.expectedRevision+1,value:structuredClone(change.value)});return {applied:true};
    }};
}
const origin=new Uint8Array(8).fill(7),window={frames:56,ms:10000},endpoint='wss://example.test/r2';
test('replacement factories share an atomic budget and wait for the old window',async()=>{
  const store=memory();let time=100000;
  const options={store,origin,window,endpoint,now:()=>time};
  const a=await createOriginPacer(options),b=await createOriginPacer(options);
  for(let i=0;i<40;i++)assert.equal(await a.reserve(),0);
  const simultaneous=await Promise.all(Array.from({length:40},(_,i)=>(i%2?a:b).reserve()));
  let admitted=40+simultaneous.filter(n=>n===0).length;
  while(admitted<56){assert.equal(await b.reserve(),0);admitted++;}
  const replacement=await createOriginPacer(options);
  assert.equal(await replacement.reserve(),10000);
  time+=9999;assert.equal(await replacement.reserve(),1);
  time++;assert.equal(await replacement.reserve(),0);
  assert.equal(store.records.size,1);
});
test('different relay endpoints and origins have independent budgets',async()=>{
  const store=memory(),options={store,origin,window,endpoint,now:()=>50000};
  const a=await createOriginPacer(options);
  for(let i=0;i<56;i++)await a.reserve();
  assert.equal(await (await createOriginPacer({...options,endpoint:'wss://other.test/r2'})).reserve(),0);
  assert.equal(await (await createOriginPacer({...options,origin:new Uint8Array(8).fill(8)})).reserve(),0);
});
test('clock rollback and corrupt timing metadata impose a full conservative window',async()=>{
  const store=memory();let time=100000;
  const pacer=await createOriginPacer({store,origin,window,endpoint,now:()=>time});
  assert.equal(await pacer.reserve(),0);time=50000;
  assert.equal(await pacer.reserve(),10000);time+=10000;assert.equal(await pacer.reserve(),0);
  [...store.records.values()][0].value={format:'corrupt'};
  assert.equal(await pacer.reserve(),10000);time+=10000;assert.equal(await pacer.reserve(),0);
});
test('storage failure and repeated contention never grant an unrecorded token',async()=>{
  const base={origin,window,endpoint,now:()=>100000};
  await assert.rejects((await createOriginPacer({...base,store:{read:async()=>{throw Error('blocked');},compareAndSwapMany(){}}})).reserve());
  assert.equal(await (await createOriginPacer({...base,store:{read:async()=>null,compareAndSwapMany:async()=>({applied:false})}})).reserve(),25);
});
test('time sampled after a queued read does not mistake another tab for clock rollback',async()=>{
  const store=memory();let time=100000;
  const options={store,origin,window,endpoint,now:()=>time};
  const other=await createOriginPacer(options);await other.reserve();
  let queued=true;
  const delayed={...store,read:async(...args)=>{
    if(queued){queued=false;time++;await other.reserve();}
    return store.read(...args);
  }};
  assert.equal(await(await createOriginPacer({...options,store:delayed})).reserve(),0);
  assert.equal([...store.records.values()][0].value.recent.length,3);
});
