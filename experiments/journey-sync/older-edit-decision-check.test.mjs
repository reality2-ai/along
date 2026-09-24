import {initializeSoftwarePersona} from '../tg-pairing/software-persona.mjs';
import {emptyState,changeJourney,journeyId,projectJourney} from './state.mjs';
import {setupJourneyGeneration} from './migration-setup.mjs';
import {openIsolatedPlannerStorage} from './isolated-preferences.mjs';
import {preferenceKey,readEnvelope,writePreferences} from './app-preferences.mjs';
import {createOlderEditReview} from './older-edit-review.mjs';
import {retainOlderEditDecision} from './older-edit-decision.mjs';
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
  return {group:setup.group,reviewId:review.id,olderRaw:input.olderRaw};
}
