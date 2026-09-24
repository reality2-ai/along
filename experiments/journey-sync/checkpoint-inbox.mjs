// Internal staging only. Call through the consent adapter and an authenticated
// session. One slot per group bounds storage; nothing here installs a generation.
import {validateState} from './state.mjs';
import {validateGenerationState} from './generation-state.mjs';
import {verifyJourneyCheckpoint} from './generation-checkpoint.mjs';
const scope='along-journey-checkpoint-inbox-v1',replicas='along-saved-journeys-v2';
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const fail=()=>new Error('Checkpoint retention unconfirmed; a retained copy may already exist');
export async function retainJourneyCheckpoint({store,expectedGroup,checkpoint,snapshot,signal}) {
  if(!(expectedGroup instanceof Uint8Array)||expectedGroup.length!==32
      ||!(checkpoint instanceof Uint8Array)||checkpoint.length!==184
      ||store.capabilities?.transactionChecks!==true)throw fail();
  const group=hex(expectedGroup),bytes=checkpoint.slice(),copy=validateState(snapshot,group);
  let wrote=false;
  const active=()=>{if(signal?.aborted)throw fail();};
  for(let attempt=0;attempt<8;attempt++){
    active();
    const replica=await store.read(replicas,group),saved=await store.read(scope,group);
    if(!replica)throw fail();
    const current=validateGenerationState(replica.value,group);
    if(saved){
      const value=saved.value;
      if(!value||Object.keys(value).sort().join(',')!=='checkpoint,format,previous,snapshot'
          ||value.format!==1||!(value.checkpoint instanceof Uint8Array)
          ||hex(value.checkpoint)!==hex(bytes))throw fail();
      const next=await verifyJourneyCheckpoint({bytes,current:value.previous,snapshot:copy});
      await verifyJourneyCheckpoint({bytes,current:value.previous,snapshot:value.snapshot});
      const before=validateGenerationState(value.previous,group);
      if(!((current.generation===before.generation&&current.checkpoint===before.checkpoint)
          ||(current.generation===next.generation&&current.checkpoint===next.checkpoint)))throw fail();
      active();
      if((await store.read(replicas,group))?.revision!==replica.revision
          ||(await store.read(scope,group))?.revision!==saved.revision)continue;
      active();
      return {status:'checkpoint-retained-for-review',generation:next.generation,alreadyRetained:!wrote};
    }
    await verifyJourneyCheckpoint({bytes,current,snapshot:copy});
    active();
    const result=await store.compareAndSwapMany([{scope,key:group,expectedRevision:0,
      value:{format:1,previous:current,checkpoint:bytes,snapshot:copy}}],
      {signal,checks:[{scope:replicas,key:group,expectedRevision:replica.revision}]});
    wrote ||= result.applied;
    // Read back and verify the retained winner, including after our own commit.
  }
  throw fail();
}
