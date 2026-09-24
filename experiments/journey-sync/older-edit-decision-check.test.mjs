import {readOlderEditRecovery,applyOlderEditRecovery,finishOlderEditRecovery} from './older-edit-recovery.mjs';
import {resetOlderEditDecision} from './older-edit-reset.mjs';
import {readJourneyStartupState} from './startup-state.mjs';
import {readOlderEditProgress} from './older-edit-progress.mjs';
import {openGenerationAppJourneyStore} from './generation-app-store.mjs';
import {initializeSoftwarePersona} from '../tg-pairing/software-persona.mjs';
import {emptyState,changeJourney,journeyId,projectJourney} from './state.mjs';
import {setupJourneyGeneration} from './migration-setup.mjs';
import {openIsolatedPlannerStorage} from './isolated-preferences.mjs';
import {preferenceKey,readEnvelope,writePreferences} from './app-preferences.mjs';
import {createOlderEditReview} from './older-edit-review.mjs';
import {retainOlderEditDecision} from './older-edit-decision.mjs';
import {applyOlderEditDecision} from './older-edit-application.mjs';
export async function checkOlderEditDecision({wasm,store}){
  const check=(value,message)=>{if(!value)throw Error(message);};
  const refuses=async promise=>check(await promise.then(()=>false,()=>true),'expected older-decision refusal');
  const setup=await initializeSoftwarePersona({wasm,store}),group=Uint8Array.from(setup.group.match(/../g),n=>parseInt(n,16));
  const point=id=>({id,name:id,lat:-36,lon:174});
  const live=projectJourney({from:point('Home'),to:point('Work'),savedRoutes:[{mode:'bus',route:'70'}]});
  const state=changeJourney(emptyState(setup.group),setup.member,journeyId(live),live);
  await store.compareAndSwap('along-saved-journeys-v1',setup.group,0,state);
  const storage={getItem:key=>localStorage.getItem('older-decision:'+key),setItem:(key,value)=>localStorage.setItem('older-decision:'+key,value)};
  const raw=JSON.stringify({learning:false,journeys:[{...live,saved:true,count:7}],journeySync:{format:1,group:setup.group,pending:[]}});
  storage.setItem(preferenceKey,raw);
  await setupJourneyGeneration({wasm,store,expectedGroup:group,expectedRevision:1,expectedRaw:raw,storage});
  const isolated=openIsolatedPlannerStorage({group:setup.group,storage});
  const edit=route=>{
    const data=JSON.parse(storage.getItem(preferenceKey));data.journeys[0].savedRoutes=[{mode:'bus',route}];
    check(writePreferences(data,storage),'older writer failed');
  };
  edit('75');
  const before=await store.read('along-saved-journeys-v2',setup.group),currentRaw=readEnvelope(isolated).raw;
  const input={current:before.value,currentRaw,sourceRaw:raw,olderRaw:storage.getItem(preferenceKey),actor:setup.member};
  const review=await createOlderEditReview(input),choices=review.differences.map(d=>({id:d.id,use:'older'}));
  const options={wasm,store,expectedGroup:group,storage,reviewId:review.id,choices};
  const pending='along-older-edit-pending-v1',decisions='along-older-edit-decisions-v1';
  await refuses(retainOlderEditDecision({...options,store:{...store,compareAndSwapMany:async()=>{throw Error('quota');}}}));
  check(await store.read(pending,setup.group)===null,'quota left pending pointer');
  let raced=false;
  await refuses(retainOlderEditDecision({...options,store:{...store,compareAndSwapMany:async(...args)=>{
    if(!raced){raced=true;const membership=await store.read('membership',setup.group);
      await store.compareAndSwap('membership',setup.group,membership.revision,membership.value);}
    return store.compareAndSwapMany(...args);
  }}}));
  check(raced&&await store.read(decisions,review.id)===null,'identity race retained decision');
  const cancelled=new AbortController();
  await refuses(retainOlderEditDecision({...options,signal:cancelled.signal,store:{...store,compareAndSwapMany:async(...args)=>{
    const result=await store.compareAndSwapMany(...args);cancelled.abort();return result;
  }}}));
  check((await readJourneyStartupState(options)).status==='older-edit-pending','retained work did not pause startup');
  await refuses(openGenerationAppJourneyStore({store,group:setup.group,actor:setup.member,storage:isolated}).reconcile());
  const retry=await retainOlderEditDecision(options);
  check(retry.alreadyRetained&&retry.reviewCurrent&&!retry.applied,'retained retry status incorrect');
  check(JSON.stringify(await store.read('along-saved-journeys-v2',setup.group))===JSON.stringify(before),'staging changed replica');
  check(readEnvelope(isolated).raw===currentRaw,'staging changed planner');
  const saved=await store.read(decisions,review.id);
  check(saved.value.input.olderRaw===input.olderRaw&&saved.value.decision.changes[0].value.savedRoutes[0].route==='75','retained decision lost evidence');
  edit('80');
  check(!(await retainOlderEditDecision(options)).reviewCurrent,'new older edit mistaken for reviewed input');
  const next=await createOlderEditReview({...input,olderRaw:storage.getItem(preferenceKey)});
  await refuses(retainOlderEditDecision({...options,reviewId:next.id,choices:next.differences.map(d=>({id:d.id,use:'older'}))}));
  check(JSON.parse(storage.getItem(preferenceKey)).journeys[0].savedRoutes[0].route==='80','later edit overwritten');
  await refuses(applyOlderEditDecision(options));
  check((await store.read('along-saved-journeys-v2',setup.group)).revision===before.revision,'stale application changed replica');
  // Restore this fixture's exact reviewed older bytes to exercise interrupted
  // application independently from the stale-review refusal above.
  storage.setItem(preferenceKey,input.olderRaw);
  await refuses(applyOlderEditDecision({...options,storage:{...storage,setItem:(key,value)=>{
    if(key.endsWith(':generation-profile-v1'))throw Error('planner quota');storage.setItem(key,value);
  }}}));
  await refuses(resetOlderEditDecision(options));
  const committed=await store.read('along-saved-journeys-v2',setup.group);
  check(committed.value.journeys[0].value.savedRoutes[0].route==='75','replica application was not retained');
  check(readEnvelope(isolated).raw===currentRaw,'failed planner write changed local data');
  check(!(await store.read('along-older-edit-applications-v1',review.id)).value.complete,'failed planner write marked complete');
  const newerLocal=JSON.parse(currentRaw);newerLocal.learning=true;
  isolated.setItem(preferenceKey,JSON.stringify(newerLocal));
  await refuses(applyOlderEditDecision(options));
  check(readEnvelope(isolated).data.learning===true,'retry overwrote newer planner data');
  isolated.setItem(preferenceKey,currentRaw);
  edit('80');
  let finalAttempt=false;
  await refuses(applyOlderEditDecision({...options,store:{...store,compareAndSwapMany:async(changes,settings)=>{
    if(changes.some(change=>change.scope===pending)){finalAttempt=true;throw Error('acknowledgment storage failure');}
    return store.compareAndSwapMany(changes,settings);
  }}}));
  check(finalAttempt&&readEnvelope(isolated).data.journeys[0].savedRoutes[0].route==='75','interrupted acknowledgment lost planner cutover');
  check(!(await store.read('along-older-edit-applications-v1',review.id)).value.complete,'interrupted acknowledgment completed');
  const applied=await applyOlderEditDecision(options);
  check(applied.status==='older-edits-applied-locally'&&applied.olderChangesPending,'application lost a later older edit');
  check((await store.read('along-saved-journeys-v2',setup.group)).revision===committed.revision,'application retry duplicated replica changes');
  const localAfter=readEnvelope(isolated);
  check(localAfter.data.journeys[0].savedRoutes[0].route==='75'&&localAfter.data.journeys[0].count===7,'planner cutover lost choice/history');
  check((await store.read(pending,setup.group)).value.olderRaw===input.olderRaw,'acknowledgment consumed newer older bytes');
  check((await applyOlderEditDecision(options)).alreadyApplied,'completed application retry failed');
  check(JSON.parse(storage.getItem(preferenceKey)).journeys[0].savedRoutes[0].route==='80','application rewrote old tab');
  const progress=await readOlderEditProgress({store,group:setup.group,member:setup.member,sourceRaw:raw});
  check(progress.sourceRaw===input.olderRaw&&!progress.pendingReviewId,'completed review not used as next baseline');
  const current=await store.read('along-saved-journeys-v2',setup.group);
  const secondInput={current:current.value,currentRaw:readEnvelope(isolated).raw,sourceRaw:progress.sourceRaw,olderRaw:storage.getItem(preferenceKey),actor:setup.member};
  const second=await createOlderEditReview(secondInput);
  const secondOptions={...options,reviewId:second.id,choices:second.differences.map(d=>({id:d.id,use:'current'}))};
  await retainOlderEditDecision(secondOptions);await applyOlderEditDecision(secondOptions);
  check((await readJourneyStartupState(options)).legacyChangesPending===false,'acknowledged older edits keep reappearing');
  check(readEnvelope(isolated).data.journeys[0].savedRoutes[0].route==='75','keeping current route lost the chosen route');
  edit('70'); // Back to the original migration value is still a new old-tab edit.
  const baseline=await readOlderEditProgress({store,group:setup.group,member:setup.member,sourceRaw:raw});
  const third=await createOlderEditReview({...secondInput,current:(await store.read('along-saved-journeys-v2',setup.group)).value,
    currentRaw:readEnvelope(isolated).raw,sourceRaw:baseline.sourceRaw,olderRaw:storage.getItem(preferenceKey)});
  check(third.differences.length===1,'edit returning to migration value was missed');
  const thirdOptions={...options,reviewId:third.id,choices:third.differences.map(d=>({id:d.id,use:'older'}))};
  await retainOlderEditDecision(thirdOptions);await applyOlderEditDecision(thirdOptions);
  check((await readJourneyStartupState(options)).status==='generation-ready'&&!(await readJourneyStartupState(options)).legacyChangesPending,'finished review did not resume startup');
  check(readEnvelope(isolated).data.journeys[0].savedRoutes[0].route==='70'&&readEnvelope(isolated).data.journeys[0].count===7,'later review lost history or route');
  check(isolated.inspectLegacy().sourceRaw===raw,'review overwrote original migration evidence');
  edit('80');
  // Use the actual last acknowledged snapshot, not the newly edited old copy.
  const held=await readOlderEditProgress({store,group:setup.group,member:setup.member,sourceRaw:raw});
  const stale=await createOlderEditReview({current:(await store.read('along-saved-journeys-v2',setup.group)).value,
    currentRaw:readEnvelope(isolated).raw,sourceRaw:held.sourceRaw,olderRaw:storage.getItem(preferenceKey),actor:setup.member});
  const staleOptions={...options,reviewId:stale.id,choices:stale.differences.map(d=>({id:d.id,use:'older'}))};
  await retainOlderEditDecision(staleOptions);edit('81');
  await refuses(applyOlderEditDecision(staleOptions));
  const replicaBeforeReset=await store.read('along-saved-journeys-v2',setup.group),plannerBeforeReset=readEnvelope(isolated).raw;
  await refuses(resetOlderEditDecision({...staleOptions,store:{...store,compareAndSwapMany:async()=>{throw Error('quota');}}}));
  check((await readJourneyStartupState(options)).status==='older-edit-pending','failed reset resumed sharing');
  const resetCancel=new AbortController();
  await refuses(resetOlderEditDecision({...staleOptions,signal:resetCancel.signal,store:{...store,compareAndSwapMany:async(...args)=>{const result=await store.compareAndSwapMany(...args);resetCancel.abort();return result;}}}));
  check((await resetOlderEditDecision(staleOptions)).status==='older-review-reset','reset retry unavailable');
  check(JSON.stringify(await store.read('along-saved-journeys-v2',setup.group))===JSON.stringify(replicaBeforeReset)&&readEnvelope(isolated).raw===plannerBeforeReset,'reset changed saved places');
  check((await store.read(decisions,stale.id)).value.input.olderRaw.includes('80'),'reset discarded compared copies');
  await refuses(applyOlderEditDecision(staleOptions));
  const refreshed=await readOlderEditProgress({store,group:setup.group,member:setup.member,sourceRaw:raw});
  check(refreshed.sourceRaw===held.sourceRaw,'reset acknowledged unreviewed edits');
  const finalReview=await createOlderEditReview({current:replicaBeforeReset.value,currentRaw:plannerBeforeReset,
    sourceRaw:refreshed.sourceRaw,olderRaw:storage.getItem(preferenceKey),actor:setup.member});
  const finalOptions={...options,reviewId:finalReview.id,choices:finalReview.differences.map(d=>({id:d.id,use:'older'}))};
  await retainOlderEditDecision(finalOptions);await applyOlderEditDecision(finalOptions);
  check(readEnvelope(isolated).data.journeys[0].savedRoutes[0].route==='81','fresh review missed the latest edit');
  edit('82');
  const nextProgress=await readOlderEditProgress({store,group:setup.group,member:setup.member,sourceRaw:raw});
  const interrupted=await createOlderEditReview({current:(await store.read('along-saved-journeys-v2',setup.group)).value,
    currentRaw:readEnvelope(isolated).raw,sourceRaw:nextProgress.sourceRaw,olderRaw:storage.getItem(preferenceKey),actor:setup.member});
  const interruptedOptions={...options,reviewId:interrupted.id,choices:interrupted.differences.map(d=>({id:d.id,use:'older'}))};
  await retainOlderEditDecision(interruptedOptions);
  const failPlanner={...storage,setItem:(key,value)=>{if(key.endsWith(':generation-profile-v1'))throw Error('planner quota');storage.setItem(key,value);}};
  await refuses(applyOlderEditDecision({...interruptedOptions,storage:failPlanner}));
  const newer=readEnvelope(isolated).data;newer.learning=true;newer.journeys[0].count=12;newer.journeys[0].savedRoutes=[{mode:'bus',route:'90'}];
  check(writePreferences(newer,isolated),'newer planner edit failed');
  const recovery=await readOlderEditRecovery(options),recoveryOptions={...options,reviewId:recovery.id,choices:recovery.differences.map(d=>({id:d.id,use:'local'}))};
  const beforeRecoveryRace=await store.read('along-saved-journeys-v2',setup.group);let recoveryRace=false;
  await refuses(applyOlderEditRecovery({...recoveryOptions,store:{...store,compareAndSwapMany:async(...args)=>{
    if(!recoveryRace){recoveryRace=true;const membership=await store.read('membership',setup.group);await store.compareAndSwap('membership',setup.group,membership.revision,membership.value);}
    return store.compareAndSwapMany(...args);
  }}}));
  check(recoveryRace&&(await store.read('along-saved-journeys-v2',setup.group)).revision===beforeRecoveryRace.revision,'recovery identity race changed replica');
  await refuses(applyOlderEditRecovery({...recoveryOptions,storage:failPlanner}));
  check((await readJourneyStartupState(options)).status==='older-edit-pending','partial recovery resumed sharing');
  const newerAgain=readEnvelope(isolated).data;newerAgain.journeys[0].savedRoutes=[{mode:'bus',route:'91'}];
  check(writePreferences(newerAgain,isolated),'later recovery edit failed');
  await refuses(finishOlderEditRecovery({...options,recoveryId:recovery.id}));
  const replacement=await readOlderEditRecovery(options),replacementOptions={...options,reviewId:replacement.id,choices:replacement.differences.map(d=>({id:d.id,use:'local'}))};
  await refuses(applyOlderEditRecovery({...replacementOptions,store:{...store,compareAndSwapMany:async(changes,settings)=>{
    if(changes.some(c=>c.scope==='along-older-edit-applications-v1'&&c.value.complete))throw Error('recovery acknowledgment quota');
    return store.compareAndSwapMany(changes,settings);
  }}}));
  const recoveryRevision=(await store.read('along-saved-journeys-v2',setup.group)).revision;
  check((await finishOlderEditRecovery({...options,recoveryId:replacement.id})).status==='older-recovery-applied-locally','retained recovery could not finish');
  check((await finishOlderEditRecovery({...options,recoveryId:replacement.id})).alreadyApplied,'completed recovery retry failed');
  check((await store.read('along-saved-journeys-v2',setup.group)).revision===recoveryRevision,'recovery retry duplicated replica edits');
  check(readEnvelope(isolated).data.journeys[0].savedRoutes[0].route==='91'&&readEnvelope(isolated).data.journeys[0].count===12&&readEnvelope(isolated).data.learning,'recovery lost latest local data');
  check((await readJourneyStartupState(options)).status==='generation-ready','completed recovery did not resume');
  return {group:setup.group,reviewId:interrupted.id,olderRaw:storage.getItem(preferenceKey)};
}
