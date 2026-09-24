// Local consent adapters for checkpoint retention and reviewed installation. The enclosing
// transport must authenticate peer possession; a public certificate is not that
// proof. No network message or automatic installation is wired here.
import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {openMembership} from '../tg-pairing/membership.mjs';
import {readJourneyPermission} from './permission.mjs';
import {installJourneyCheckpoint} from './checkpoint-installation.mjs';
import {retainJourneyCheckpoint} from './checkpoint-inbox.mjs';
const hex = bytes => Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const fail = () => new Error('Checkpoint peer permission unavailable; a committed operation may already exist');
export async function acceptPermittedJourneyCheckpoint(options) {
  return permittedCheckpoint(options,installJourneyCheckpoint);
}
export async function retainPermittedJourneyCheckpoint(options) {
  return permittedCheckpoint(options,retainJourneyCheckpoint);
}
async function permittedCheckpoint({wasm,store,expectedGroup,peer,certificate,...options},operation) {
  if (!(expectedGroup instanceof Uint8Array)||expectedGroup.length!==32||!(peer instanceof Uint8Array)||peer.length!==32
      ||!(certificate instanceof Uint8Array)) throw fail();
  const group=expectedGroup.slice(), selected=peer.slice(), proof=certificate.slice(), groupId=hex(group);
  const input=structuredClone({checkpoint:options.checkpoint,snapshot:options.snapshot});
  const persona=await store.read('candidate-persona','active'), membership=await store.read('membership',groupId);
  const identity=await loadLocalPersona({wasm,store,expectedGroup:group});
  const permission=await readJourneyPermission({wasm,store,expectedGroup:group});
  if(!persona||!membership||!identity||identity.member===hex(selected)||permission.member!==identity.member
      ||!permission.peers.includes(hex(selected)))throw fail();
  const held=openMembership(store,wasm,group,persona.value.record.subject);
  try{if(await held.peerStatus(proof,selected)!=='current')throw fail();}finally{held.close();}
  const guards=[
    {scope:'candidate-persona',key:'active',expectedRevision:persona.revision},
    {scope:'membership',key:groupId,expectedRevision:membership.revision},
    {scope:'along-journey-sharing-v1',key:groupId,expectedRevision:permission.revision},
  ];
  const check=async()=>{
    if(options.signal?.aborted)throw fail();
    for(const guard of guards)if((await store.read(guard.scope,guard.key))?.revision!==guard.expectedRevision)throw fail();
  };
  await check();
  const guarded={...store,compareAndSwapMany:(changes,settings)=>{
    const checks=[...(settings?.checks??[])];
    for(const guard of guards){
      const existing=checks.find(c=>c.scope===guard.scope&&c.key===guard.key);
      if(existing&&existing.expectedRevision!==guard.expectedRevision)return Promise.resolve({applied:false});
      if(!existing)checks.push(guard);
    }
    return store.compareAndSwapMany(changes,{...settings,checks});
  }};
  const result=await operation({...options,...input,wasm,store:guarded,expectedGroup:group});
  await check();
  return result;
}
