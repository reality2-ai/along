// Internal replicated storage. Network callers must separately enforce current
// identity, membership and consent. This never creates or adopts a generation.
import {validateGenerationState,mergeGenerationStates,JourneyGenerationMismatch} from './generation-state.mjs';
import {checkpointPosition} from './checkpoint-selection.mjs';
const scope='along-saved-journeys-v2';
export function openGenerationJourneyStore({store,group,version}){
  const held=checkpointPosition(version,group);
  if(store.capabilities?.transactionChecks!==true)throw Error('Journey storage unavailable');
  const validate=value=>{
    const state=validateGenerationState(value,group);
    if(state.generation!==held.generation||state.checkpoint!==held.checkpoint)throw new JourneyGenerationMismatch();
    return state;
  };
  const read=async()=>{
    const record=await store.read(scope,group);
    if(!record)throw Error('Journey generation must be installed first');
    return {revision:record.revision,state:validate(record.value)};
  };
  return Object.freeze({read,
    async merge(snapshot,{signal}={}){
      const copy=validate(snapshot);
      for(let attempt=0;attempt<8;attempt++){
        if(signal?.aborted)throw Error('Journey merge cancelled');
        const before=await read(),state=mergeGenerationStates(before.state,copy);
        const result=await store.compareAndSwapMany([{scope,key:group,expectedRevision:before.revision,value:state}],{signal});
        if(result.applied)return {status:'generation-journeys-saved',state,revision:result.revisions[0]};
      }
      throw Error('Journey storage busy; retry the merge');
    },
  });
}
