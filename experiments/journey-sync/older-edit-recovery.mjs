import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {openIsolatedPlannerStorage} from './isolated-preferences.mjs';
import {preferenceKey,appliedEvent} from './app-preferences.mjs';
import {createOlderEditReview} from './older-edit-review.mjs';
import {createOlderEditRecoveryReview} from './older-edit-recovery-review.mjs';
import {changeGenerationJourney} from './generation-state.mjs';
const pending='along-older-edit-pending-v1',applications='along-older-edit-applications-v1',recoveries='along-older-edit-recoveries-v1',replicas='along-saved-journeys-v2';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b),valid=id=>typeof id==='string'&&/^[0-9a-f]{64}$/.test(id);
const fail=()=>new Error('Interrupted review recovery unconfirmed; saved recovery may need finishing');
async function context({wasm,store,expectedGroup,storage=globalThis.localStorage,signal}){
  if(!(expectedGroup instanceof Uint8Array)||expectedGroup.length!==32||store.capabilities?.transactionChecks!==true)throw fail();
  const group=expectedGroup.slice(),key=Array.from(group,b=>b.toString(16).padStart(2,'0')).join(''),observed=new Map();
  const active=()=>{if(signal?.aborted)throw fail();};
  const read=async(scope,key)=>{active();const record=await store.read(scope,key),revision=record?.revision??0,id=scope+'\0'+key;
    if(observed.has(id)&&observed.get(id).expectedRevision!==revision)throw fail();observed.set(id,{scope,key,expectedRevision:revision});return record;};
  const identity=await loadLocalPersona({wasm,store:{...store,read},expectedGroup:group});if(!identity)throw fail();
  const pointer=await read(pending,key),p=pointer?.value;
  if(!p||![1,2,4].includes(p.format)||p.member!==identity.member||!valid(p.reviewId))throw fail();
  const application=await read(applications,p.reviewId),original=await read('along-older-edit-decisions-v1',p.reviewId);
  if(application?.value?.format!==1||application.value.member!==identity.member||application.value.reviewId!==p.reviewId
      ||original?.value?.member!==identity.member||original.value.input?.actor!==identity.member)throw fail();
  const initial=await createOlderEditReview(original.value.input),decision=initial.resolve(original.value.choices);
  if(initial.id!==p.reviewId||!equal(decision,original.value.decision))throw fail();
  let after=original.value.input.current;
  for(const change of decision.changes)after=changeGenerationJourney(after,identity.member,change.id,change.value);
  if(!equal(after,application.value.after)||application.value.olderRaw!==original.value.input.olderRaw)throw fail();
  const replica=await read(replicas,key),isolated=openIsolatedPlannerStorage({group:key,storage});
  if(isolated.inspectLegacy().sourceRaw!==(original.value.input.profileSourceRaw??original.value.input.sourceRaw))throw fail();
  const check=async()=>{active();for(const g of observed.values())if(((await store.read(g.scope,g.key))?.revision??0)!==g.expectedRevision)throw fail();active();};
  const write=async changes=>{
    await check();const changed=new Set(changes.map(c=>c.scope+'\0'+c.key));
    const result=await store.compareAndSwapMany(changes,{signal,checks:[...observed].filter(([id])=>!changed.has(id)).map(([,g])=>g)});
    if(!result.applied)throw fail();changes.forEach((c,i)=>observed.set(c.scope+'\0'+c.key,{scope:c.scope,key:c.key,expectedRevision:result.revisions[i]}));active();return result;
  };
  return {key,identity,pointer,application,replica,isolated,read,check,write,active};
}
async function checkedRecovery(record,member){
  if(record?.value?.format!==1||record.value.member!==member||record.value.input?.actor!==member||typeof record.value.complete!=='boolean')throw fail();
  const value=record.value,review=await createOlderEditRecoveryReview(value.input),decision=review.resolve(value.choices);
  if(review.id!==value.recoveryId||review.applicationReviewId!==value.applicationReviewId||!equal(decision,value.decision))throw fail();
  return value;
}
async function freshReview(ctx){
  const p=ctx.pointer.value;if(ctx.application.value.complete||![1,4].includes(p.format))throw fail();
  let application=ctx.application.value;
  if(p.format===4){
    if(!valid(p.recoveryId))throw fail();
    const retained=await checkedRecovery(await ctx.read(recoveries,p.recoveryId),ctx.identity.member);
    if(retained.complete||retained.applicationReviewId!==p.reviewId)throw fail();
    application={...application,after:retained.decision.after};
  }
  const input={application,current:ctx.replica.value,currentRaw:ctx.isolated.getItem(preferenceKey),actor:ctx.identity.member};
  const review=await createOlderEditRecoveryReview(input);await ctx.check();
  if(ctx.isolated.getItem(preferenceKey)!==input.currentRaw)throw fail();return {input,review};
}
export async function readOlderEditRecovery(options){return (await freshReview(await context(options))).review;}
export async function applyOlderEditRecovery(options){
  const {reviewId,choices,locks=globalThis.navigator?.locks,signal}=options;
  if(!valid(reviewId)||!Array.isArray(choices)||!locks?.request)throw fail();
  const selected=structuredClone(choices),group=Array.from(options.expectedGroup??[],b=>b.toString(16).padStart(2,'0')).join('');
  return locks.request('along-journey-import:'+group,{signal},async()=>{
    const ctx=await context(options),previous=await ctx.read(recoveries,reviewId);
    if(previous){
      const retained=await checkedRecovery(previous,ctx.identity.member);
      if(!equal(retained.choices,selected)||retained.applicationReviewId!==ctx.pointer.value.reviewId)throw fail();
    }else{
      const {input,review}=await freshReview(ctx);if(review.id!==reviewId)throw fail();
      const decision=review.resolve(selected),value={format:1,member:ctx.identity.member,applicationReviewId:ctx.pointer.value.reviewId,recoveryId:reviewId,input,choices:selected,decision,complete:false};
      await ctx.check();if(ctx.isolated.getItem(preferenceKey)!==input.currentRaw)throw fail();
      await ctx.write([{scope:replicas,key:group,expectedRevision:ctx.replica.revision,value:decision.after},
        {scope:recoveries,key:reviewId,expectedRevision:0,value},
        {scope:pending,key:group,expectedRevision:ctx.pointer.revision,value:{format:4,member:ctx.identity.member,reviewId:value.applicationReviewId,recoveryId:reviewId}}]);
    }
    return finish({...options,recoveryId:reviewId});
  });
}
// Caller already holds the group lock; completion retries do not edit the replica.
async function finish(options){
  const {recoveryId}=options,ctx=await context(options),record=await ctx.read(recoveries,recoveryId),value=await checkedRecovery(record,ctx.identity.member),p=ctx.pointer.value;
  if(value.applicationReviewId!==p.reviewId)throw fail();
  if(value.complete){if(p.format!==2||!ctx.application.value.complete||p.olderRaw!==ctx.application.value.olderRaw)throw fail();await ctx.check();return {status:'older-recovery-applied-locally',reviewId:recoveryId,alreadyApplied:true};}
  if(p.format!==4||p.recoveryId!==recoveryId||ctx.application.value.complete||!equal(ctx.replica.value,value.decision.after))throw fail();
  await ctx.check();const raw=ctx.isolated.getItem(preferenceKey);
  if(raw!==value.input.currentRaw&&raw!==value.decision.outputRaw)throw fail();
  ctx.active();if(raw!==value.decision.outputRaw)ctx.isolated.setItem(preferenceKey,value.decision.outputRaw);
  if(ctx.isolated.getItem(preferenceKey)!==value.decision.outputRaw)throw fail();
  await ctx.write([{scope:recoveries,key:recoveryId,expectedRevision:record.revision,value:{...value,complete:true}},
    {scope:applications,key:p.reviewId,expectedRevision:ctx.application.revision,value:{...ctx.application.value,complete:true}},
    {scope:pending,key:ctx.key,expectedRevision:ctx.pointer.revision,value:{format:2,member:ctx.identity.member,reviewId:p.reviewId,olderRaw:ctx.application.value.olderRaw}}]);
  globalThis.dispatchEvent?.(new Event(appliedEvent));return {status:'older-recovery-applied-locally',reviewId:recoveryId,alreadyApplied:false};
}
export async function finishOlderEditRecovery(options){
  const locks=options.locks??globalThis.navigator?.locks;if(!locks?.request||!valid(options.recoveryId))throw fail();
  const group=Array.from(options.expectedGroup??[],b=>b.toString(16).padStart(2,'0')).join('');
  return locks.request('along-journey-import:'+group,{signal:options.signal},()=>finish(options));
}
