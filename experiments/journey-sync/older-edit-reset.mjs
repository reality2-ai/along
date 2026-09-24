import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {openIsolatedPlannerStorage} from './isolated-preferences.mjs';
import {readOlderEditProgress} from './older-edit-progress.mjs';
// Explicitly retire an unapplied choice, retaining its compared copies. Never
// roll back a replica or abandon a partially committed application.
export async function resetOlderEditDecision({wasm,store,expectedGroup,reviewId,storage=globalThis.localStorage,locks=globalThis.navigator?.locks,signal}){
  if(!(expectedGroup instanceof Uint8Array)||expectedGroup.length!==32||!/^[0-9a-f]{64}$/.test(reviewId)||!locks?.request||store.capabilities?.transactionChecks!==true)throw Error('Review reset unavailable');
  const group=expectedGroup.slice(),key=Array.from(group,b=>b.toString(16).padStart(2,'0')).join('');
  return locks.request('along-journey-import:'+key,{signal},async()=>{
    const active=()=>{if(signal?.aborted)throw Error('Review reset cancelled');};active();
    const observed=new Map(),audited={...store,read:async(scope,key)=>{
      active();const record=await store.read(scope,key),revision=record?.revision??0,id=scope+'\0'+key;
      if(observed.has(id)&&observed.get(id).expectedRevision!==revision)throw Error('Review changed');
      observed.set(id,{scope,key,expectedRevision:revision});return record;
    }};
    const identity=await loadLocalPersona({wasm,store:audited,expectedGroup:group});if(!identity)throw Error('Device unavailable');
    const isolated=openIsolatedPlannerStorage({group:key,storage});
    const progress=await readOlderEditProgress({store:audited,group:key,member:identity.member,sourceRaw:isolated.inspectLegacy().sourceRaw});
    if(progress.pointer?.value.reviewId!==reviewId||![1,3].includes(progress.pointer.value.format))throw Error('Retained review changed');
    if(await audited.read('along-older-edit-applications-v1',reviewId))throw Error('Finish the started application before reviewing again');
    active();if(progress.pointer.value.format===3)return {status:'older-review-reset',reviewId};
    const scope='along-older-edit-pending-v1';
    const result=await store.compareAndSwapMany([{scope,key,expectedRevision:progress.pointer.revision,
      value:{format:3,member:identity.member,reviewId}}],{signal,checks:[...observed.values()].filter(g=>g.scope!==scope)});
    if(!result.applied)throw Error('Review reset unconfirmed');active();
    return {status:'older-review-reset',reviewId};
  });
}
