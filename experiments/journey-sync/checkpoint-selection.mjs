// A peer's advertised position selects retained evidence; it never authorizes
// local adoption. The receiver must check its actual state during retention.
import {validateGenerationState} from './generation-state.mjs';
import {verifyJourneyCheckpoint} from './generation-checkpoint.mjs';
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
export function checkpointPosition(value,group){
  if(!value||Object.keys(value).sort().join(',')!=='checkpoint,generation')throw Error('Checkpoint position unavailable');
  const state=validateGenerationState({format:2,group,...value,clock:0,journeys:[]},group);
  return {generation:state.generation,checkpoint:state.checkpoint};
}
export async function selectNextCheckpoint({store,group,peerState}){
  const position=checkpointPosition(peerState,group),key=group+':'+(position.generation+1);
  const current={format:2,group,...position,clock:0,journeys:[]};
  const scopes=['along-prepared-journey-checkpoint-v1','along-journey-checkpoint-recovery-v1'];
  const records=await Promise.all(scopes.map(scope=>store.read(scope,key)));
  let bundle;
  for(const record of records){
    if(!record)continue;
    if(record.value?.format!==1)throw Error('Retained checkpoint unavailable');
    const value=record.value;
    await verifyJourneyCheckpoint({bytes:value.checkpoint,current,snapshot:value.snapshot});
    if(bundle&&hex(bundle.checkpoint)!==hex(value.checkpoint))throw Error('Conflicting retained checkpoints');
    bundle={checkpoint:value.checkpoint.slice(),snapshot:structuredClone(value.snapshot)};
  }
  for(let i=0;i<scopes.length;i++)if(((await store.read(scopes[i],key))?.revision??0)!==(records[i]?.revision??0))throw Error('Retained checkpoint changed');
  return bundle??null;
}
