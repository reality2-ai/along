// Called by the actual enrollment fixture. Signed checkpoint bytes are handed
// directly to this adapter; this is not evidence of checkpoint wire delivery.
import {setupJourneyGeneration} from './migration-setup.mjs';
import {openIsolatedPlannerStorage} from './isolated-preferences.mjs';
import {loadSoftwareIssuer} from '../tg-pairing/software-persona.mjs';
import {readJourneyPermission,setJourneyPermission} from './permission.mjs';
import {acceptPermittedJourneyCheckpoint,retainPermittedJourneyCheckpoint} from './checkpoint-permission.mjs';
import {createCheckpointReview} from './checkpoint-review.mjs';
import {applyCheckpointChoices} from './checkpoint-choice-commit.mjs';
import {preferenceKey,readEnvelope} from './app-preferences.mjs';
export async function checkEnrolledCheckpoint({wasm,owner,receiver,group}) {
  const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  const groupId=hex(group), check=(value,message)=>{if(!value)throw Error(message);};
  const refuses=async promise=>check(await promise.then(()=>false,()=>true),'expected checkpoint refusal');
  const adapters=[];
  for(const [index,device] of [owner,receiver].entries()) {
    const before=await device.store.read('along-saved-journeys-v1',groupId);
    const journeys=before.value.journeys.filter(j=>j.value).map(j=>({...j.value,saved:true,count:7,hours:Array(24).fill(0),days:Array(7).fill(0),last:0}));
    const raw=JSON.stringify({learning:false,journeys,journeySync:{format:1,group:groupId,pending:[]}});
    const prefix='enrolled-checkpoint-'+index+':';
    const storage={getItem:key=>localStorage.getItem(prefix+key),setItem:(key,value)=>localStorage.setItem(prefix+key,value)};
    storage.setItem(preferenceKey,raw);
    await setupJourneyGeneration({wasm,store:device.store,expectedGroup:group,expectedRevision:before.revision,expectedRaw:raw,storage});
    adapters.push(openIsolatedPlannerStorage({group:groupId,storage}));
  }
  const before=await receiver.store.read('along-saved-journeys-v2',groupId);
  const issuer=await loadSoftwareIssuer({wasm,store:owner.store,expectedGroup:group});
  const ownerState=await owner.store.read('along-saved-journeys-v2',groupId);
  const prepared=await issuer.prepareJourneyCheckpoint({expectedRevision:ownerState.revision});issuer.close();
  const consent={wasm,store:receiver.store,expectedGroup:group,peer:owner.subject,certificate:owner.certificate};
  const grant=async allow=>setJourneyPermission({...consent,allow,expectedRevision:(await readJourneyPermission(consent)).revision});
  const input={...consent,expectedRevision:before.revision,expectedLocalRaw:readEnvelope(adapters[1]).raw,
    checkpoint:prepared.checkpoint,snapshot:prepared.snapshot,storage:adapters[1]};
  await grant(false);await refuses(acceptPermittedJourneyCheckpoint(input));
  await refuses(retainPermittedJourneyCheckpoint(input));await grant(true);
  const inboxScope='along-journey-checkpoint-inbox-v1';
  let retentionRace=false;
  await refuses(retainPermittedJourneyCheckpoint({...input,store:{...receiver.store,compareAndSwapMany:async(...args)=>{
    if(!retentionRace){retentionRace=true;await grant(false);}return receiver.store.compareAndSwapMany(...args);
  }}}));
  check(retentionRace&&await receiver.store.read(inboxScope,groupId)===null,'denied retention left a checkpoint');
  await grant(true);
  await refuses(retainPermittedJourneyCheckpoint({...input,store:{...receiver.store,compareAndSwapMany:async()=>{
    throw new DOMException('test storage full','QuotaExceededError');
  }}}));
  check(await receiver.store.read(inboxScope,groupId)===null,'failed storage retained a checkpoint');
  const damaged=prepared.checkpoint.slice();damaged[183]^=1;
  await refuses(retainPermittedJourneyCheckpoint({...input,checkpoint:damaged}));
  const cancelled=new AbortController();
  await refuses(retainPermittedJourneyCheckpoint({...input,signal:cancelled.signal,
    store:{...receiver.store,compareAndSwapMany:async(...args)=>{
      const result=await receiver.store.compareAndSwapMany(...args);cancelled.abort();return result;
    }}}));
  const retained=await retainPermittedJourneyCheckpoint(input);
  check(retained.status==='checkpoint-retained-for-review'&&retained.alreadyRetained,'retention after cancelled confirmation failed');
  check((await retainPermittedJourneyCheckpoint(input)).alreadyRetained,'retention retry failed');
  check((await receiver.store.read('along-saved-journeys-v2',groupId)).revision===before.revision,'retention installed checkpoint');
  check(readEnvelope(adapters[1]).raw===input.expectedLocalRaw,'retention changed planner');
  const inbox=await receiver.store.read(inboxScope,groupId);
  check(inbox.value.checkpoint.length===184&&inbox.value.previous.generation===0,'retained bundle incomplete');
  await refuses(acceptPermittedJourneyCheckpoint({...input,peer:receiver.subject,certificate:receiver.certificate}));
  const bad=prepared.checkpoint.slice();bad[183]^=1;
  await refuses(acceptPermittedJourneyCheckpoint({...input,checkpoint:bad}));
  let raced=false;
  await refuses(acceptPermittedJourneyCheckpoint({...input,store:{...receiver.store,compareAndSwapMany:async(...args)=>{
    if(!raced){raced=true;await grant(false);}return receiver.store.compareAndSwapMany(...args);
  }}}));
  check(raced,'permission race not exercised');
  check((await receiver.store.read('along-saved-journeys-v2',groupId)).revision===before.revision,'denied checkpoint changed replica');
  check(await receiver.store.read('along-journey-checkpoint-recovery-v1',groupId+':1')===null,'denied checkpoint left partial recovery');
  await grant(true);
  const installed=await acceptPermittedJourneyCheckpoint(input);
  check(installed.localReviewRequired&&!installed.alreadyInstalled,'recipient installation falsely completed review');
  check((await acceptPermittedJourneyCheckpoint(input)).alreadyInstalled,'recipient retry failed');
  const current=await receiver.store.read('along-saved-journeys-v2',groupId);
  const recovery=await receiver.store.read('along-journey-checkpoint-recovery-v1',groupId+':1');
  const review=await createCheckpointReview({current:current.value,recovery:recovery.value,localRaw:readEnvelope(adapters[1]).raw,actor:hex(receiver.subject)});
  const choices=review.differences.map(d=>({id:d.id,use:'local'}));
  const applied=await applyCheckpointChoices({wasm,store:receiver.store,expectedGroup:group,generation:1,reviewId:review.id,choices,storage:adapters[1]});
  check(applied.status==='journey-recovery-applied-locally','recipient local review failed');
  const local=readEnvelope(adapters[1]);
  check(local.sync.version.generation===1&&local.sync.pending.length===0&&local.data.journeys.every(j=>j.count===7),'recipient journal/history lost');
  check(local.data.journeys.some(j=>j.to.id==='sync-denied'&&j.saved),'recipient-only local save lost');
  // Revoking application consent also denies retry of already installed evidence.
  await grant(false);await refuses(acceptPermittedJourneyCheckpoint(input));
  await refuses(retainPermittedJourneyCheckpoint(input));
  console.log('PASS: actual enrolled device migrates/isolate storage, accepts an explicitly permitted signed checkpoint, retries and reviews retained differences while preserving its independent save/history; absent permission, wrong peer, bad signature and permission removal during commit leave no partial installation. Checkpoint bytes are a direct fixture handoff, not wire transport.');
}
