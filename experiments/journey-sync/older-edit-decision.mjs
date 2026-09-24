import {readOlderEditProgress} from './older-edit-progress.mjs';
// Stage an explicit decision without applying it. Both preference copies and
// the replica remain unchanged until a separate guarded application step.
import {readJourneyStartupState} from './startup-state.mjs';
import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {openIsolatedPlannerStorage} from './isolated-preferences.mjs';
import {readEnvelope} from './preference-envelope.mjs';
import {createOlderEditReview} from './older-edit-review.mjs';
const scope='along-older-edit-decisions-v1',pendingScope='along-older-edit-pending-v1',replicas='along-saved-journeys-v2';
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=()=>new Error('Older-edit decision unconfirmed; a retained decision may already exist');
export async function retainOlderEditDecision({wasm,store,expectedGroup,reviewId,choices,
  storage=globalThis.localStorage,locks=globalThis.navigator?.locks,signal}){
  if(!(expectedGroup instanceof Uint8Array)||expectedGroup.length!==32||!/^[0-9a-f]{64}$/.test(reviewId)
      ||!Array.isArray(choices)||!locks?.request||store.capabilities?.transactionChecks!==true)throw fail();
  const group=expectedGroup.slice(),groupId=hex(group),selected=structuredClone(choices);
  return locks.request('along-journey-import:'+groupId,{signal},async()=>{
    const active=()=>{if(signal?.aborted)throw fail();};active();
    const observed=new Map();
    const audited={...store,read:async(s,k)=>{
      const record=await store.read(s,k),id=s+'\0'+k,revision=record?.revision??0;
      if(observed.has(id)&&observed.get(id).expectedRevision!==revision)throw fail();
      observed.set(id,{scope:s,key:k,expectedRevision:revision});return record;
    }};
    if(!['generation-ready','older-edit-pending'].includes((await readJourneyStartupState({wasm,store:audited,expectedGroup:group,storage,signal})).status))throw fail();
    const identity=await loadLocalPersona({wasm,store:audited,expectedGroup:group});if(!identity)throw fail();
    const replica=await audited.read(replicas,groupId);
    const isolated=openIsolatedPlannerStorage({group:groupId,storage}),local=readEnvelope(isolated),legacy=isolated.inspectLegacy();
    const progress=await readOlderEditProgress({store:audited,group:groupId,member:identity.member,sourceRaw:legacy.sourceRaw});
    const pending=progress.pointer,saved=await audited.read(scope,reviewId);
    if(progress.pendingReviewId&&progress.pendingReviewId!==reviewId)throw fail();
    if(Boolean(progress.pendingReviewId)!==Boolean(saved))throw fail();
    const input=saved?structuredClone(saved.value.input):{current:replica.value,currentRaw:local.raw,
      sourceRaw:progress.sourceRaw,profileSourceRaw:legacy.sourceRaw,olderRaw:legacy.currentLegacyRaw,actor:identity.member};
    if(saved&&(saved.value?.format!==1||saved.value.member!==identity.member||saved.value.reviewId!==reviewId
        ||!equal(saved.value.choices,selected)||input.actor!==identity.member))throw fail();
    const review=await createOlderEditReview(input);
    if(review.id!==reviewId)throw fail();
    const decision=review.resolve(selected);
    if(saved&&!equal(saved.value.decision,decision))throw fail();
    const reviewCurrent=()=>{
      const now=isolated.inspectLegacy();return readEnvelope(isolated).raw===input.currentRaw
        &&now.sourceRaw===(input.profileSourceRaw??input.sourceRaw)&&now.currentLegacyRaw===input.olderRaw&&equal(replica.value,input.current);
    };
    const check=async()=>{
      active();for(const guard of observed.values())if(((await store.read(guard.scope,guard.key))?.revision??0)!==guard.expectedRevision)throw fail();
      active();
    };
    await check();
    if(saved)return {status:'older-edit-decision-retained',reviewId,alreadyRetained:true,reviewCurrent:reviewCurrent(),applied:false};
    if(!reviewCurrent())throw fail();
    const value={format:1,member:identity.member,reviewId,input,choices:selected,decision};
    const result=await store.compareAndSwapMany([
      {scope,key:reviewId,expectedRevision:0,value},
      {scope:pendingScope,key:groupId,expectedRevision:pending?.revision??0,value:{format:1,member:identity.member,reviewId}},
    ],{signal,checks:[...observed.values()].filter(g=>g.scope!==scope&&g.scope!==pendingScope)});
    if(!result.applied)throw fail();active();
    observed.delete(scope+'\0'+reviewId);observed.delete(pendingScope+'\0'+groupId);
    await check();
    const retained=await store.read(scope,reviewId),pointer=await store.read(pendingScope,groupId);
    if(!equal(retained?.value,value)||pointer?.value.reviewId!==reviewId)throw fail();active();
    return {status:'older-edit-decision-retained',reviewId,alreadyRetained:false,reviewCurrent:reviewCurrent(),applied:false};
  });
}
