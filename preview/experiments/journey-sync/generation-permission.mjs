// Application authorization only. The enclosing session must authenticate peer
// possession. Neither enrollment nor a signed checkpoint implies this consent.
import {readJourneyStartupState} from './startup-state.mjs';
import {readJourneyPermission} from './permission.mjs';
import {openMembership} from '../tg-pairing/membership.mjs';
import {openGenerationJourneyStore} from './generation-store.mjs';
import {validateGenerationState} from './generation-state.mjs';
import {openIsolatedPlannerStorage} from './isolated-preferences.mjs';
import {readEnvelope} from './preference-envelope.mjs';
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const scope='along-saved-journeys-v2';
const fail=()=>new Error('Generation sharing unavailable; check consent and local recovery');
export async function openPermittedGenerationJourneys({wasm,store,expectedGroup,peer,certificate,
  storage=globalThis.localStorage,locks=globalThis.navigator?.locks}){
  if(!(expectedGroup instanceof Uint8Array)||expectedGroup.length!==32||!(peer instanceof Uint8Array)||peer.length!==32
      ||!(certificate instanceof Uint8Array)||certificate.length!==136||!locks?.request
      ||store.capabilities?.transactionChecks!==true)throw fail();
  const group=expectedGroup.slice(),selected=peer.slice(),proof=certificate.slice(),groupId=hex(group);
  const observed=new Map();
  const audited={...store,read:async(s,k)=>{
    const record=await store.read(s,k),id=s+'\0'+k,revision=record?.revision??0;
    if(observed.has(id)&&observed.get(id).expectedRevision!==revision)throw fail();
    observed.set(id,{scope:s,key:k,expectedRevision:revision});return record;
  }};
  const startup=await readJourneyStartupState({wasm,store:audited,expectedGroup:group,storage});
  if(startup.status!=='generation-ready')throw fail();
  const permission=await readJourneyPermission({wasm,store:audited,expectedGroup:group});
  if(permission.member===hex(selected)||!permission.peers.includes(hex(selected)))throw fail();
  const persona=await audited.read('candidate-persona','active');
  const membership=openMembership(store,wasm,group,persona.value.record.subject);
  try{if(await membership.peerStatus(proof,selected)!=='current')throw fail();}finally{membership.close();}
  const record=await audited.read(scope,groupId),initial=validateGenerationState(record.value,groupId);
  const version={generation:initial.generation,checkpoint:initial.checkpoint};
  // Ordinary edits can change the replica; its CAS and version check belong to
  // the merge store. Identity, consent and recovery evidence remain fixed here.
  const guards=[...observed.values()].filter(g=>g.scope!==scope);
  const local=openIsolatedPlannerStorage({group:groupId,storage});
  const check=async()=>{
    for(const guard of guards)if(((await store.read(guard.scope,guard.key))?.revision??0)!==guard.expectedRevision)throw fail();
    const envelope=readEnvelope(local),held=envelope.sync?.version??{generation:0,checkpoint:'0'.repeat(64)};
    if(envelope.sync?.group!==groupId||held.generation!==version.generation||held.checkpoint!==version.checkpoint)throw fail();
    const now=await store.read(scope,groupId);
    if(!now)throw fail();
    const state=validateGenerationState(now.value,groupId);
    if(state.generation!==version.generation||state.checkpoint!==version.checkpoint)throw fail();
  };
  const guarded={...store,compareAndSwapMany:(changes,options)=>store.compareAndSwapMany(changes,
    {...options,checks:[...(options?.checks??[]),...guards]})};
  const replica=openGenerationJourneyStore({store:guarded,group:groupId,version});
  await check();
  const run=(operation,signal)=>locks.request('along-device-preview-journey-import:'+groupId,{signal},async()=>{
    if(signal?.aborted)throw fail();await check();
    const result=await operation();await check();if(signal?.aborted)throw fail();return result;
  });
  return Object.freeze({version:Object.freeze({...version}),check,
    snapshot:({signal}={})=>run(async()=>(await replica.read()).state,signal),
    merge(snapshot,{signal}={}){
      const copy=validateGenerationState(snapshot,groupId);
      return run(()=>replica.merge(copy,{signal}),signal);
    },
  });
}
