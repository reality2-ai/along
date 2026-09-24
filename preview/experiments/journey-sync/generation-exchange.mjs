// Separate frame domain for ordinary snapshots within an installed generation.
// A receipt confirms replicated storage, not planner reconciliation or history.
import {createBoundedExchange} from './exchange.mjs';
import {validateGenerationState,JourneyGenerationMismatch} from './generation-state.mjs';
import {checkpointPosition} from './checkpoint-selection.mjs';
export function createGenerationJourneyExchange({group,version,...options}){
  const held=checkpointPosition(version,group);
  const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
  const validate=value=>{
    const state=validateGenerationState(value,group);
    if(state.generation!==held.generation||state.checkpoint!==held.checkpoint)throw new JourneyGenerationMismatch();
    return state;
  };
  const exchange=createBoundedExchange({...options,frameBase:48,
    commitStatus:'generation-journeys-saved',resultStatus:'peer-saved-generation-snapshot',
    encode:value=>encoder.encode(JSON.stringify(validate(value))),
    decode:bytes=>validate(JSON.parse(decoder.decode(bytes)))});
  return Object.freeze({sendSnapshot:exchange.sendPayload,receive:exchange.receive,close:exchange.close,signal:exchange.signal});
}
