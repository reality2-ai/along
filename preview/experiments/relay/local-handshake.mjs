import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {openMembership} from '../tg-pairing/membership.mjs';
import {readJourneyPermission} from '../journey-sync/permission.mjs';
import {createRelayHandshake} from './handshake.mjs';
const hex=b=>Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');
// Selected, already enrolled peer only. No permission grant, enrollment, replica
// read or planner write occurs here. Snapshot merge needs its own guarded adapter.
export async function openLocalRelayHandshake({wasm,store,expectedGroup,peer,certificate,role,signal}) {
  const fixed=(v,n)=>v instanceof Uint8Array&&v.length===n;
  if(!fixed(expectedGroup,32)||!fixed(peer,32)||!fixed(certificate,136))throw Error('Relay peer unavailable');
  const group=expectedGroup.slice(),remote=peer.slice(),proof=certificate.slice(),observed=new Map();
  const current=()=>{if(signal?.aborted)throw Error('Relay peer cancelled');};current();
  const audited={...store,read:async(scope,key)=>{
    current();const record=await store.read(scope,key),revision=record?.revision??0,id=scope+'\0'+key;current();
    if(observed.has(id)&&observed.get(id).revision!==revision)throw Error('Relay authority changed');
    observed.set(id,{scope,key,revision});return record;
  }};
  const identity=await loadLocalPersona({wasm,store:audited,expectedGroup:group});
  if(!identity||identity.member===hex(remote))throw Error('Different relay peer required');
  const permission=await readJourneyPermission({wasm,store:audited,expectedGroup:group});
  if(permission.member!==identity.member||!permission.peers.includes(hex(remote)))throw Error('Journey sharing permission required');
  const record=await audited.read('candidate-persona','active');
  const membership=openMembership(audited,wasm,group,record.value.record.subject);
  try{
    if(await membership.peerStatus(proof,remote)!=='current')throw Error('Relay peer membership unavailable');
    const context=await membership.sessionContext();
    if(context.epoch!==identity.epoch)throw Error('Relay epoch changed');
  }finally{membership.close();}
  const check=async()=>{
    current();
    for(const {scope,key,revision} of observed.values()){
      if(((await store.read(scope,key))?.revision??0)!==revision)throw Error('Relay authority changed');current();
    }
  };
  await check();
  return createRelayHandshake({role,group,epoch:identity.epoch,local:record.value.record.subject,peer:remote,
    sign:identity.sign,check,signal});
}
