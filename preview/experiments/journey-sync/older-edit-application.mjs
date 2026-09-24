// Applies a retained explicit decision. Shared-state commit and local planner
// replacement are separate durable steps; retry must not repeat replica edits.
import {readJourneyStartupState} from './startup-state.mjs';
import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {openIsolatedPlannerStorage} from './isolated-preferences.mjs';
import {readEnvelope,preferenceKey,appliedEvent} from './app-preferences.mjs';
import {createOlderEditReview} from './older-edit-review.mjs';
import {changeGenerationJourney} from './generation-state.mjs';
import {journeyId,projectJourney} from './state.mjs';
const decisions='along-older-edit-decisions-v1',pendingScope='along-older-edit-pending-v1';
const applications='along-older-edit-applications-v1',replicas='along-saved-journeys-v2';
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=()=>new Error('Older-edit application unconfirmed; retained work may need finishing');
export async function applyOlderEditDecision({wasm,store,expectedGroup,reviewId,
  storage=globalThis.localStorage,locks=globalThis.navigator?.locks,signal}){
  if(!(expectedGroup instanceof Uint8Array)||expectedGroup.length!==32||!/^[0-9a-f]{64}$/.test(reviewId)
      ||!locks?.request||store.capabilities?.transactionChecks!==true)throw fail();
  const group=expectedGroup.slice(),groupId=hex(group);
  return locks.request('along-device-preview-journey-import:'+groupId,{signal},async()=>{
    const active=()=>{if(signal?.aborted)throw fail();};active();
    const observed=new Map(),id=(s,k)=>s+'\0'+k;
    const audited={...store,read:async(s,k)=>{
      const record=await store.read(s,k),key=id(s,k),revision=record?.revision??0;
      if(observed.has(key)&&observed.get(key).expectedRevision!==revision)throw fail();
      observed.set(key,{scope:s,key:k,expectedRevision:revision});return record;
    }};
    if(!['generation-ready','older-edit-pending'].includes((await readJourneyStartupState({wasm,store:audited,expectedGroup:group,storage,signal})).status))throw fail();
    const identity=await loadLocalPersona({wasm,store:audited,expectedGroup:group});if(!identity)throw fail();
    const saved=await audited.read(decisions,reviewId),pointer=await audited.read(pendingScope,groupId);
    const application=await audited.read(applications,reviewId),replica=await audited.read(replicas,groupId);
    if(saved?.value?.format!==1||saved.value.member!==identity.member||saved.value.reviewId!==reviewId
        ||pointer?.value?.member!==identity.member||pointer.value.reviewId!==reviewId
        ||![1,2].includes(pointer.value.format))throw fail();
    const input=structuredClone(saved.value.input);
    if(input.actor!==identity.member)throw fail();
    const review=await createOlderEditReview(input),decision=review.resolve(saved.value.choices);
    if(review.id!==reviewId||!equal(decision,saved.value.decision))throw fail();
    let after=input.current;
    for(const change of decision.changes)after=changeGenerationJourney(after,identity.member,change.id,change.value);
    const local=readEnvelope({getItem:()=>input.currentRaw}),values=new Map(decision.saved.map(v=>[journeyId(v),v]));
    const journeys=local.data.journeys.map(journey=>{
      const key=journeyId(projectJourney(journey)),value=values.get(key);values.delete(key);
      return value?{...journey,...value,saved:true}:{...journey,saved:false,savedRoutes:null};
    });
    for(const value of values.values())journeys.push({...value,saved:true,count:0,hours:Array(24).fill(0),days:Array(7).fill(0),last:0});
    const outputRaw=JSON.stringify({...local.data,journeys,journeySync:{...local.sync,olderReview:reviewId}});
    const proposed={format:1,member:identity.member,reviewId,after,outputRaw,olderRaw:input.olderRaw,complete:false};
    if(application&&!equal(application.value,{...proposed,complete:application.value.complete}))throw fail();
    if(application&&typeof application.value.complete!=='boolean')throw fail();
    const isolated=openIsolatedPlannerStorage({group:groupId,storage});
    const check=async()=>{
      active();for(const g of observed.values())if(((await store.read(g.scope,g.key))?.revision??0)!==g.expectedRevision)throw fail();active();
    };
    const checksExcept=scopes=>[...observed.values()].filter(g=>!scopes.includes(g.scope));
    await check();
    if(application?.value.complete){
      if(pointer.value.format!==2||pointer.value.olderRaw!==input.olderRaw)throw fail();
      globalThis.dispatchEvent?.(new Event(appliedEvent));
      return {status:'older-edits-applied-locally',reviewId,alreadyApplied:true,olderChangesPending:isolated.inspectLegacy().currentLegacyRaw!==input.olderRaw};
    }
    if(pointer.value.format!==1)throw fail();
    if(!application){
      const legacy=isolated.inspectLegacy();
      if(!equal(replica.value,input.current)||readEnvelope(isolated).raw!==input.currentRaw
          ||legacy.sourceRaw!==(input.profileSourceRaw??input.sourceRaw)||legacy.currentLegacyRaw!==input.olderRaw)throw fail();
      const result=await store.compareAndSwapMany([
        {scope:replicas,key:groupId,expectedRevision:replica.revision,value:after},
        {scope:applications,key:reviewId,expectedRevision:0,value:proposed},
      ],{signal,checks:checksExcept([replicas,applications])});
      if(!result.applied)throw fail();
      observed.get(id(replicas,groupId)).expectedRevision=result.revisions[0];
      observed.get(id(applications,reviewId)).expectedRevision=result.revisions[1];
    }else if(!equal(replica.value,after))throw fail();
    await check();
    const raw=isolated.getItem(preferenceKey);
    if(raw!==input.currentRaw&&raw!==outputRaw)throw fail();
    active();if(raw!==outputRaw)isolated.setItem(preferenceKey,outputRaw);
    if(isolated.getItem(preferenceKey)!==outputRaw)throw fail();
    const result=await store.compareAndSwapMany([
      {scope:applications,key:reviewId,expectedRevision:observed.get(id(applications,reviewId)).expectedRevision,value:{...proposed,complete:true}},
      {scope:pendingScope,key:groupId,expectedRevision:pointer.revision,value:{format:2,member:identity.member,reviewId,olderRaw:input.olderRaw}},
    ],{signal,checks:checksExcept([applications,pendingScope])});
    if(!result.applied)throw fail();active();
    globalThis.dispatchEvent?.(new Event(appliedEvent));
    return {status:'older-edits-applied-locally',reviewId,alreadyApplied:false,olderChangesPending:isolated.inspectLegacy().currentLegacyRaw!==input.olderRaw};
  });
}
