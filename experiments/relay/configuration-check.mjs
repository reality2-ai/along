// Browser test helper: durable local preference, never contacts a relay.
import {readRelayConfiguration,saveRelayConfiguration} from './configuration.mjs';
export async function checkRelayConfiguration({wasm,store,group,member}) {
  const options={wasm,store,expectedGroup:group,member};
  const check=(v,why)=>{if(!v)throw Error(why);},denied=fn=>fn().then(()=>false,()=>true);
  const initial=await readRelayConfiguration(options);check(initial.url===null&&!initial.enabled,'no default relay');
  const saved=await saveRelayConfiguration({...options,expectedRevision:initial.revision,url:'wss://relay.example/r2',enabled:true});
  check((await readRelayConfiguration(options)).enabled,'explicit selection retained');
  check(await denied(()=>saveRelayConfiguration({...options,expectedRevision:initial.revision,url:'wss://stale.example/r2',enabled:true})),'stale form refused');
  const removed=await saveRelayConfiguration({...options,expectedRevision:saved.revision,enabled:false,remove:true});
  const empty=await readRelayConfiguration(options);check(empty.revision===removed.revision&&!empty.enabled&&empty.url===null,'removal tombstone preserves revision');
  check(await denied(()=>saveRelayConfiguration({...options,expectedRevision:saved.revision,url:'wss://relay.example/r2',enabled:true})),'stale enable cannot undo removal');
  check(await denied(()=>saveRelayConfiguration({...options,expectedRevision:empty.revision,url:'wss://relay.example/r2?key=secret',enabled:true})),'credential query refused');
  let raced=false;
  const raceStore={...store,compareAndSwapMany:async(...args)=>{
    if(!raced){raced=true;const held=await store.read('candidate-persona','active');await store.compareAndSwap('candidate-persona','active',held.revision,held.value);}
    return store.compareAndSwapMany(...args);
  }};
  check(await denied(()=>saveRelayConfiguration({...options,store:raceStore,expectedRevision:empty.revision,url:'wss://relay.example/r2',enabled:true}))&&raced,'identity race refused');
  check((await readRelayConfiguration(options)).revision===empty.revision,'race leaves preference unchanged');
  const final=await saveRelayConfiguration({...options,expectedRevision:empty.revision,url:'wss://relay.example/r2',enabled:false});
  return final;
}
