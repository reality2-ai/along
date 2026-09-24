// Read-only three-way saved-place review. A guarded writer must rebuild this
// from fresh records before applying choices or acknowledging the older copy.
import {readEnvelope,savedValues} from './app-preferences.mjs';
import {validateState} from './state.mjs';
import {validateGenerationState,changeGenerationJourney} from './generation-state.mjs';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const zero='0'.repeat(64),fail=()=>new Error('Older saved-place review unavailable');
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
export async function createOlderEditReview({current,currentRaw,sourceRaw,olderRaw,actor}){
  const state=validateGenerationState(current,current.group);
  if(!/^[0-9a-f]{64}$/.test(actor)||[currentRaw,sourceRaw,olderRaw].some(raw=>typeof raw!=='string'))throw fail();
  const parse=(raw,older)=>{
    const envelope=readEnvelope({getItem:()=>raw});
    // Released v37 strips unknown sharing metadata when saving preferences.
    // Its local older-copy data is reviewable, never authority for the current
    // group. Current state must still carry its verified group/version binding.
    const plainOlder=older&&!Object.hasOwn(envelope.data,'journeySync');
    if(!plainOlder&&envelope.sync?.group!==state.group)throw fail();
    const version=envelope.sync?.version??{generation:0,checkpoint:zero};
    if(older?(version.generation!==0||version.checkpoint!==zero)
      :(version.generation!==state.generation||version.checkpoint!==state.checkpoint||envelope.sync?.pending.length))throw fail();
    const saved=savedValues(envelope.data),pending=new Map();
    if(saved.size!==envelope.data.journeys.filter(journey=>journey.saved).length)throw fail();
    for(const operation of envelope.sync?.pending??[]){
      const origin=operation.version??{generation:0,checkpoint:zero};
      if(typeof operation.id!=='string'||!/^[0-9a-f-]{36}$/.test(operation.id)
          ||!Array.isArray(operation.changes)||operation.changes.length>512
          ||origin.generation!==0||origin.checkpoint!==zero)throw fail();
      for(const change of operation.changes){
        const checked=validateState({format:1,group:state.group,clock:1,
          journeys:[{id:change.id,actor,clock:1,value:change.value}]},state.group).journeys[0];
        pending.set(checked.id,checked.value);
      }
    }
    for(const [id,value] of pending)if(!equal(saved.get(id)??null,value))throw fail();
    return saved;
  };
  const local=parse(currentRaw,false),source=parse(sourceRaw,true),older=parse(olderRaw,true);
  const replicated=new Map(state.journeys.filter(j=>j.value!==null).map(j=>[j.id,j.value]));
  if(local.size!==replicated.size||[...local].some(([id,value])=>!equal(value,replicated.get(id))))throw fail();
  const changed=[...new Set([...source.keys(),...older.keys()])].sort()
    .filter(id=>!equal(source.get(id)??null,older.get(id)??null));
  const differences=changed.filter(id=>!equal(local.get(id)??null,older.get(id)??null))
    .map(id=>({id,current:local.get(id)??null,older:older.get(id)??null}));
  const bytes=new TextEncoder().encode(JSON.stringify(['along/older-edit-review/v1',actor,state,currentRaw,sourceRaw,olderRaw]));
  const id=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
  return Object.freeze({id,changedSavedPlaces:changed.length,differences:structuredClone(differences),
    resolve(choices){
      if(!Array.isArray(choices)||choices.length!==differences.length)throw fail();
      const selected=new Map();
      for(const choice of choices){
        if(!choice||Object.keys(choice).sort().join(',')!=='id,use'||!['current','older'].includes(choice.use)
            ||selected.has(choice.id))throw fail();
        selected.set(choice.id,choice.use);
      }
      let planned=state;const changes=[];
      for(const difference of differences){
        if(!selected.has(difference.id))throw fail();
        if(selected.get(difference.id)==='older'){
          planned=changeGenerationJourney(planned,actor,difference.id,difference.older);
          changes.push({id:difference.id,value:structuredClone(difference.older)});
        }
      }
      return {reviewId:id,changes,generation:state.generation,checkpoint:state.checkpoint,
        saved:planned.journeys.filter(j=>j.value!==null).map(j=>structuredClone(j.value))};
    },
  });
}
