import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {openMembership} from '../tg-pairing/membership.mjs';
import {readJourneyPermission} from '../journey-sync/permission.mjs';
const magic=new TextEncoder().encode('ALNRDS01'),domain=new TextEncoder().encode('along/relay/discovery/v1\0');
const hex=b=>Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');
const fixed=(b,n)=>b instanceof Uint8Array&&b.length===n;
const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const signing=body=>{const out=new Uint8Array(domain.length+body.length);out.set(domain);out.set(body,domain.length);return out;};
function audit(store,signal){
  const observed=new Map(),current=()=>{if(signal?.aborted)throw Error('Relay discovery cancelled');};
  return {store:{...store,read:async(scope,key)=>{
    current();const record=await store.read(scope,key),revision=record?.revision??0,id=scope+'\0'+key;current();
    if(observed.has(id)&&observed.get(id).revision!==revision)throw Error('Relay discovery authority changed');
    observed.set(id,{scope,key,revision});return record;
  }},async check(){for(const {scope,key,revision} of observed.values()){
    current();if(((await store.read(scope,key))?.revision??0)!==revision)throw Error('Relay discovery authority changed');
  }current();}};
}
// Public signed metadata only. Caller must have explicitly enabled this relay.
// No address, route, AT key, history or application payload appears here.
export async function createRelayAnnouncement({wasm,store,expectedGroup,signal}) {
  if(!fixed(expectedGroup,32))throw Error('Relay discovery group unavailable');
  const group=expectedGroup.slice(),held=audit(store,signal);
  const persona=await loadLocalPersona({wasm,store:held.store,expectedGroup:group});
  if(!persona)throw Error('Relay discovery identity unavailable');
  const record=(await held.store.read('candidate-persona','active')).value.record;
  const body=new Uint8Array(240);body.set(magic);body.set(group,8);body.set(record.subject,40);
  body.set(record.certificate,72);body.set(crypto.getRandomValues(new Uint8Array(32)),208);
  const signature=await persona.sign(signing(body));await held.check();
  if(!fixed(signature,64))throw Error('Relay discovery signature unavailable');
  const packet=new Uint8Array(304);packet.set(body);packet.set(signature,240);return packet;
}
// A discovery result is a candidate for a FRESH authenticated handshake, never
// an online/connected assertion, permission grant, or membership installation.
export async function acceptRelayAnnouncement({wasm,store,expectedGroup,packet,signal}) {
  if(!fixed(expectedGroup,32)||!fixed(packet,304))throw Error('Relay announcement unavailable');
  const group=expectedGroup.slice(),copy=packet.slice();
  if(!equal(copy.subarray(0,8),magic)||!equal(copy.subarray(8,40),group))throw Error('Different relay announcement');
  const peer=copy.slice(40,72),certificate=copy.slice(72,208),held=audit(store,signal);
  const permission=await readJourneyPermission({wasm,store:held.store,expectedGroup:group});
  if(permission.member===hex(peer)||!permission.peers.includes(hex(peer)))throw Error('Relay peer lacks journey permission');
  const record=await held.store.read('candidate-persona','active');
  const membership=openMembership(held.store,wasm,group,record.value.record.subject);
  try{await membership.sessionContext();if(await membership.peerStatus(certificate,peer)!=='current')throw Error('Relay peer membership unavailable');}
  finally{membership.close();}
  const key=await crypto.subtle.importKey('raw',peer,'Ed25519',false,['verify']);
  if(!await crypto.subtle.verify('Ed25519',key,copy.subarray(240),signing(copy.subarray(0,240))))throw Error('Relay announcement signature refused');
  await held.check();
  return Object.freeze({peer,certificate,nonce:copy.slice(208,240),status:'verified-discovery-hint'});
}
