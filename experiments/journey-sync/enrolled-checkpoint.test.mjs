// Actual enrollment fixture: direct adapter fault checks plus authenticated
// checkpoint WebRTC transfer. Signaling is copied by the harness on one host.
import {setupJourneyGeneration} from './migration-setup.mjs';
import {openIsolatedPlannerStorage} from './isolated-preferences.mjs';
import {loadSoftwareIssuer} from '../tg-pairing/software-persona.mjs';
import {readJourneyPermission,setJourneyPermission} from './permission.mjs';
import {acceptPermittedJourneyCheckpoint,retainPermittedJourneyCheckpoint} from './checkpoint-permission.mjs';
import {createCheckpointReview} from './checkpoint-review.mjs';
import {applyCheckpointChoices} from './checkpoint-choice-commit.mjs';
import {preferenceKey,readEnvelope} from './app-preferences.mjs';
import {openCheckpointSession} from './checkpoint-session.mjs';
import {installJourneyCheckpoint} from './checkpoint-installation.mjs';
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
  const senderContext={wasm,store:owner.store,expectedGroup:group,peer:receiver.subject,certificate:receiver.certificate};
  await setJourneyPermission({...senderContext,allow:true,expectedRevision:(await readJourneyPermission(senderContext)).revision});
  const connect=async(receiverOptions={})=>{
    const sessions=[];
    try {
      sessions.push(await openCheckpointSession({...senderContext,role:'offer',timeoutMs:2000}));
      sessions.push(await openCheckpointSession({...consent,role:'answer',timeoutMs:2000,...receiverOptions}));
      const offer=await sessions[0].offer(),answer=await sessions[1].accept(offer);await sessions[0].accept(answer);
      await Promise.all(sessions.map(s=>s.authenticated()));return sessions;
    }catch(error){sessions.forEach(s=>s.close());throw error;}
  };
  await grant(false);await refuses(acceptPermittedJourneyCheckpoint(input));
  await refuses(openCheckpointSession({...consent,role:'answer'}));
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
  const interrupted=await connect({signal:cancelled.signal,
    store:{...receiver.store,compareAndSwapMany:async(...args)=>{
      const result=await receiver.store.compareAndSwapMany(...args);cancelled.abort();return result;
    }}});
  try{await refuses(interrupted[0].sendCheckpoint({checkpoint:prepared.checkpoint,snapshot:prepared.snapshot}));}
  finally{interrupted.forEach(s=>s.close());}
  const delivered=await connect();
  try {
    check((await delivered[0].sendCheckpoint({checkpoint:prepared.checkpoint,snapshot:prepared.snapshot})).status==='peer-retained-checkpoint',
      'authenticated retry did not confirm durable retention');
    await grant(false);
    await refuses(delivered[0].sendCheckpoint({checkpoint:prepared.checkpoint,snapshot:prepared.snapshot}));
  } finally {delivered.forEach(s=>s.close());}
  await grant(true);
  const retained=await retainPermittedJourneyCheckpoint(input);
  check(retained.status==='checkpoint-retained-for-review'&&retained.alreadyRetained,'retention after cancelled confirmation failed');
  check((await retainPermittedJourneyCheckpoint(input)).alreadyRetained,'retention retry failed');
  check((await receiver.store.read('along-saved-journeys-v2',groupId)).revision===before.revision,'retention installed checkpoint');
  check(readEnvelope(adapters[1]).raw===input.expectedLocalRaw,'retention changed planner');
  const inbox=await receiver.store.read(inboxScope,groupId);
  check(inbox.value.checkpoint.length===184&&inbox.value.previous.generation===0,'retained bundle incomplete');
  await installJourneyCheckpoint({wasm,store:owner.store,expectedGroup:group,expectedRevision:ownerState.revision,
    expectedLocalRaw:readEnvelope(adapters[0]).raw,checkpoint:prepared.checkpoint,snapshot:prepared.snapshot,storage:adapters[0]});
  const ownerInstalled=await owner.store.read('along-saved-journeys-v2',groupId);
  const ownerRecovery=await owner.store.read('along-journey-checkpoint-recovery-v1',groupId+':1');
  const ownerReview=await createCheckpointReview({current:ownerInstalled.value,recovery:ownerRecovery.value,
    localRaw:readEnvelope(adapters[0]).raw,actor:hex(owner.subject)});
  await applyCheckpointChoices({wasm,store:owner.store,expectedGroup:group,generation:1,reviewId:ownerReview.id,
    choices:ownerReview.differences.map(d=>({id:d.id,use:'local'})),storage:adapters[0]});
  const nextIssuer=await loadSoftwareIssuer({wasm,store:owner.store,expectedGroup:group});
  const successor=await nextIssuer.prepareJourneyCheckpoint({expectedRevision:(await owner.store.read('along-saved-journeys-v2',groupId)).revision});
  nextIssuer.close();
  const nextBundle={checkpoint:successor.checkpoint,snapshot:successor.snapshot};
  await refuses(retainPermittedJourneyCheckpoint({...consent,...nextBundle}));
  check((await receiver.store.read(inboxScope,groupId)).revision===inbox.revision,'skipped predecessor replaced pending checkpoint');
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
  const oldGeneration=await connect();
  let installed;
  try {
    installed=await acceptPermittedJourneyCheckpoint(input);
    await refuses(oldGeneration[0].sendCheckpoint({checkpoint:prepared.checkpoint,snapshot:prepared.snapshot}));
  } finally {oldGeneration.forEach(s=>s.close());}
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
  await refuses(retainPermittedJourneyCheckpoint({...consent,...nextBundle,store:{...receiver.store,
    read:(scope,key)=>scope==='along-journey-checkpoint-recovery-v1'?Promise.resolve(null):receiver.store.read(scope,key)}}));
  check((await receiver.store.read(inboxScope,groupId)).revision===inbox.revision,'missing archive allowed inbox advance');
  const catchup=await connect();
  try{check((await catchup[0].sendCheckpoint(nextBundle)).status==='peer-retained-checkpoint','successor retention unconfirmed');}
  finally{catchup.forEach(s=>s.close());}
  check((await receiver.store.read(inboxScope,groupId)).value.previous.generation===1,'inbox did not advance in order');
  check((await receiver.store.read('along-journey-checkpoint-recovery-v1',groupId+':1')).revision===recovery.revision,'advancement altered recovery archive');
  check(readEnvelope(adapters[1]).raw===local.raw,'retaining successor altered planner');
  await refuses(retainPermittedJourneyCheckpoint(input));
  await acceptPermittedJourneyCheckpoint({...consent,...nextBundle,storage:adapters[1],expectedLocalRaw:local.raw,
    expectedRevision:(await receiver.store.read('along-saved-journeys-v2',groupId)).revision});
  const secondCurrent=await receiver.store.read('along-saved-journeys-v2',groupId);
  const secondRecovery=await receiver.store.read('along-journey-checkpoint-recovery-v1',groupId+':2');
  const secondReview=await createCheckpointReview({current:secondCurrent.value,recovery:secondRecovery.value,
    localRaw:readEnvelope(adapters[1]).raw,actor:hex(receiver.subject)});
  await applyCheckpointChoices({wasm,store:receiver.store,expectedGroup:group,generation:2,reviewId:secondReview.id,
    choices:secondReview.differences.map(d=>({id:d.id,use:'local'})),storage:adapters[1]});
  const twiceRecovered=readEnvelope(adapters[1]);
  check(twiceRecovered.sync.version.generation===2&&twiceRecovered.sync.pending.length===0
    &&twiceRecovered.data.journeys.some(j=>j.to.id==='sync-denied'&&j.saved&&j.count===7),'second recovery lost local save/history');
  // Revoking application consent also denies retry of already installed evidence.
  await grant(false);await refuses(acceptPermittedJourneyCheckpoint(input));
  await refuses(retainPermittedJourneyCheckpoint(input));
  console.log('PASS: enrolled checkpoint transfer uses authenticated WebRTC, retains before receipt, survives lost confirmation and reconnects; direct adapter faults/installation review preserve independent saves. Signaling is harness-driven on one browser host.');
}
