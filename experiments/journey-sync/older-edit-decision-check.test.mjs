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
  return {group:setup.group,reviewId:third.id,olderRaw:storage.getItem(preferenceKey)};
}
