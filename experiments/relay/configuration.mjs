import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {relayEndpoint} from './transport.mjs';
const scope='along-relay-configuration-v1';
const hex=b=>Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');
const context=(group,member)=>{
  if(!(group instanceof Uint8Array)||group.length!==32||typeof member!=='string'||!/^[0-9a-f]{64}$/.test(member))throw Error('Relay configuration context unavailable');
  return {group:group.slice(),key:hex(group),member};
};
export async function readRelayConfiguration({store,expectedGroup,member}) {
  const ctx=context(expectedGroup,member),record=await store.read(scope,ctx.key),value=record?.value;
  if(value===undefined||value===null)return Object.freeze({revision:record?.revision??0,url:null,enabled:false});
  if(Object.keys(value).sort().join(',')!=='enabled,format,member,url'||value.format!==1||value.member!==member
      ||typeof value.enabled!=='boolean'||relayEndpoint(value.url)!==value.url)throw Error('Saved relay configuration unavailable');
  return Object.freeze({revision:record.revision,url:value.url,enabled:value.enabled});
}
// Explicit local preference, not a membership or journey-sharing grant. Removal
// retains the storage revision tombstone, so stale forms cannot restore a relay.
export async function saveRelayConfiguration({wasm,store,expectedGroup,member,expectedRevision,url,enabled,remove=false,signal}) {
  const ctx=context(expectedGroup,member),current=()=>{if(signal?.aborted)throw Error('Relay configuration cancelled');};
  current();
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||typeof remove!=='boolean'||typeof enabled!=='boolean'
      ||store.capabilities?.transactionChecks!==true)throw Error('Relay configuration unavailable');
  const endpoint=remove?null:relayEndpoint(url),observed=new Map();
  const audited={...store,read:async(s,k)=>{
    current();const record=await store.read(s,k),revision=record?.revision??0,id=s+'\0'+k;current();
    if(observed.has(id)&&observed.get(id).expectedRevision!==revision)throw Error('Relay identity changed');
    observed.set(id,{scope:s,key:k,expectedRevision:revision});return record;
  }};
  const identity=await loadLocalPersona({wasm,store:audited,expectedGroup:ctx.group});current();
  if(!identity||identity.member!==member)throw Error('Relay identity changed');
  const previous=await readRelayConfiguration({store,expectedGroup:ctx.group,member});current();
  if(previous.revision!==expectedRevision)throw Error('Relay choice changed; reopen settings');
  const value=remove?null:{format:1,member,url:endpoint,enabled};
  const result=await store.compareAndSwapMany([{scope,key:ctx.key,expectedRevision,value}],{signal,checks:[...observed.values()]});
  if(!result.applied)throw Error('Relay choice changed; reopen settings');
  return {status:remove?'relay-removed':'relay-preference-saved',revision:result.revisions[0],url:endpoint,enabled:remove?false:enabled};
}
