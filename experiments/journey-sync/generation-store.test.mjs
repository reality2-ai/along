import test from 'node:test';
import assert from 'node:assert/strict';
import {openGenerationJourneyStore} from './generation-store.mjs';
import {createGenerationJourneyExchange} from './generation-exchange.mjs';
import {changeGenerationJourney,JourneyGenerationMismatch} from './generation-state.mjs';
import {projectJourney,journeyId} from './state.mjs';
const group='a'.repeat(64),actor='b'.repeat(64),version={generation:1,checkpoint:'c'.repeat(64)};
const empty={format:2,group,...version,clock:0,journeys:[]};
const point=id=>({id,name:id,lat:-36,lon:174});
const value=n=>projectJourney({from:point('Home'),to:point('Work '+n),savedRoutes:[{mode:'bus',route:'75'}]});
const change=(state,n,author=actor)=>{const v=value(n);return changeGenerationJourney(state,author,journeyId(v),v);};
function storage(state=empty){
  let record=state?{revision:1,value:structuredClone(state)}:null;
  return {capabilities:{transactionChecks:true},read:async()=>structuredClone(record),
    compareAndSwapMany:async([c],{signal}={})=>{
      if(signal?.aborted)throw Error('cancelled');
      if((record?.revision??0)!==c.expectedRevision)return {applied:false};
      record={revision:c.expectedRevision+1,value:structuredClone(c.value)};return {applied:true,revisions:[record.revision]};
    },replace:state=>{record={revision:(record?.revision??0)+1,value:structuredClone(state)};}};
}
test('generation merges retain offline saves and deletions without changing the generation',async()=>{
  const store=storage(change(empty,1)),replica=openGenerationJourneyStore({store,group,version});
  let peer=change(change(empty,1),2);peer=changeGenerationJourney(peer,actor,journeyId(value(1)),null);
  const receipt=await replica.merge(peer);
  assert.equal(receipt.status,'generation-journeys-saved');assert.equal(receipt.state.generation,1);
  assert.equal(receipt.state.journeys.find(j=>j.id===journeyId(value(1))).value,null);
  assert.equal(receipt.state.journeys.find(j=>j.id===journeyId(value(2))).value.to.id,'Work 2');
  assert.deepEqual((await replica.merge(peer)).state,receipt.state);
});
test('missing, legacy, conflicting and newly installed generations cannot be overwritten',async()=>{
  await assert.rejects(openGenerationJourneyStore({store:storage(null),group,version}).merge(empty));
  for(const value of [{...empty,format:1},{...empty,generation:2},{...empty,checkpoint:'d'.repeat(64)}]){
    const store=storage(),replica=openGenerationJourneyStore({store,group,version});
    await assert.rejects(replica.merge(value));assert.equal((await store.read()).revision,1);
  }
  const store=storage();let raced=false;
  const guarded={...store,compareAndSwapMany:async(...args)=>{
    if(!raced){raced=true;store.replace({...empty,generation:2,checkpoint:'d'.repeat(64)});}
    return store.compareAndSwapMany(...args);
  }};
  await assert.rejects(openGenerationJourneyStore({store:guarded,group,version}).merge(change(empty,1)),JourneyGenerationMismatch);
  assert.equal((await store.read()).value.generation,2);
  assert.equal((await store.read()).value.journeys.length,0);
});
test('chunked generation transfer confirms storage, and mismatched peers cannot receive',async()=>{
  for(const mismatch of [false,true]){
    const stores=[storage(),storage()],ends=[],packets=[];
    let snapshot=empty;for(let n=0;n<15;n++)snapshot=change(snapshot,n);
    for(let i=0;i<2;i++){
      const held=mismatch&&i===1?{generation:2,checkpoint:'d'.repeat(64)}:version;
      const replica=openGenerationJourneyStore({store:stores[i],group,version:held});
      ends[i]=createGenerationJourneyExchange({group,version:held,timeoutMs:100,
        send:async p=>{packets.push(p);queueMicrotask(()=>{void ends[1-i].receive(p).catch(()=>{});});},
        commit:(s,o)=>replica.merge(s,o),onClose:()=>ends[1-i]?.close()});
    }
    try{
      if(mismatch){await assert.rejects(ends[0].sendSnapshot(snapshot));assert.equal((await stores[1].read()).revision,1);}
      else{
        assert.equal((await ends[0].sendSnapshot(snapshot)).status,'peer-saved-generation-snapshot');
        assert.deepEqual((await stores[1].read()).value,snapshot);
        assert.ok(packets.filter(p=>p[0]===50).length>1);assert.ok(packets.every(p=>p.length<=2048));
      }
    }finally{ends.forEach(e=>e.close());}
  }
});
test('concurrent same-generation edits survive retry and cancelled merges leave storage alone',async()=>{
  const store=storage();let raced=false;
  const guarded={...store,compareAndSwapMany:async(...args)=>{
    if(!raced){raced=true;store.replace(change(empty,2,'e'.repeat(64)));}
    return store.compareAndSwapMany(...args);
  }};
  const replica=openGenerationJourneyStore({store:guarded,group,version});
  const receipt=await replica.merge(change(empty,1));
  assert.deepEqual(receipt.state.journeys.map(j=>j.value.to.id).sort(),['Work 1','Work 2']);
  const before=await store.read(),controller=new AbortController();controller.abort();
  await assert.rejects(replica.merge(change(empty,3),{signal:controller.signal}));
  assert.deepEqual(await store.read(),before);
});
