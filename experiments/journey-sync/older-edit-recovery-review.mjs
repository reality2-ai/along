// Read-only comparison after a partial application. The writer must bind this
// review to the retained application, current replica and latest planner bytes.
import {readEnvelope,savedValues} from './app-preferences.mjs';
import {validateGenerationState,changeGenerationJourney} from './generation-state.mjs';
import {validateState,journeyId,projectJourney} from './state.mjs';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=()=>new Error('Interrupted older-copy review unavailable');
export async function createOlderEditRecoveryReview({application,current,currentRaw,actor}){
  const held=structuredClone(application),state=validateGenerationState(current,current.group);
  if(held?.format!==1||held.complete!==false||held.member!==actor||!/^[0-9a-f]{64}$/.test(actor)
      ||!/^[0-9a-f]{64}$/.test(held.reviewId)||!equal(held.after,state)||typeof currentRaw!=='string')throw fail();
  const local=readEnvelope({getItem:()=>currentRaw}),version=local.sync?.version??{generation:0,checkpoint:'0'.repeat(64)};
  if(local.sync?.group!==state.group||version.generation!==state.generation||version.checkpoint!==state.checkpoint)throw fail();
  const saved=savedValues(local.data),pending=new Map();
  if(saved.size!==local.data.journeys.filter(j=>j.saved).length)throw fail();
  for(const operation of local.sync.pending){
    const origin=operation.version??{generation:0,checkpoint:'0'.repeat(64)};
    if(!/^[0-9a-f-]{36}$/.test(operation.id)||!Array.isArray(operation.changes)||operation.changes.length>512
        ||origin.generation!==version.generation||origin.checkpoint!==version.checkpoint)throw fail();
    for(const change of operation.changes){
      const checked=validateState({format:1,group:state.group,clock:1,journeys:[{id:change.id,actor,clock:1,value:change.value}]},state.group).journeys[0];
      pending.set(checked.id,checked.value);
    }
  }
  for(const [id,value] of pending)if(!equal(saved.get(id)??null,value))throw fail();
  const committed=new Map(state.journeys.filter(j=>j.value!==null).map(j=>[j.id,j.value]));
  const differences=[...new Set([...saved.keys(),...committed.keys()])].sort()
    .filter(id=>!equal(saved.get(id)??null,committed.get(id)??null))
    .map(id=>({id,local:saved.get(id)??null,shared:committed.get(id)??null}));
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['along/older-edit-recovery/v1',actor,held,state,currentRaw])));
  const id=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  return Object.freeze({id,applicationReviewId:held.reviewId,differences:structuredClone(differences),
    resolve(choices){
      if(!Array.isArray(choices)||choices.length!==differences.length)throw fail();
      const selected=new Map();
      for(const choice of choices){
        if(!choice||Object.keys(choice).sort().join(',')!=='id,use'||!['local','shared'].includes(choice.use)||selected.has(choice.id))throw fail();
        selected.set(choice.id,choice.use);
      }
      let after=state;
      for(const difference of differences){
        if(!selected.has(difference.id))throw fail();
        if(selected.get(difference.id)==='local')after=changeGenerationJourney(after,actor,difference.id,difference.local);
      }
      const values=new Map(after.journeys.filter(j=>j.value!==null).map(j=>[j.id,j.value]));
      const journeys=local.data.journeys.map(journey=>{
        const key=journeyId(projectJourney(journey)),value=values.get(key);values.delete(key);
        return value?{...journey,...value,saved:true}:{...journey,saved:false,savedRoutes:null};
      });
      for(const value of values.values())journeys.push({...value,saved:true,count:0,hours:Array(24).fill(0),days:Array(7).fill(0),last:0});
      const outputRaw=JSON.stringify({...local.data,journeys,journeySync:{...local.sync,pending:[],olderReview:held.reviewId,olderRecovery:id}});
      return {reviewId:id,applicationReviewId:held.reviewId,after,outputRaw};
    }});
}
