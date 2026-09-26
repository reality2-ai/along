import {readRelayConfiguration} from './configuration.mjs';
import {createHiveRelayTransportFactory} from '../r2-current/hive-relay-transport.mjs';
import {createLocalRelayHello} from './local-hello.mjs';
import {createRelayAnnouncement,acceptRelayAnnouncement} from './discovery.mjs';
import {openRelayJourneyConnection} from './journey-connection.mjs';
import {readJourneyPermission} from '../journey-sync/permission.mjs';
const hex=b=>Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');
const discovery=new TextEncoder().encode('ALNRDS01'),application=new TextEncoder().encode('ALNRLY01');
const starts=(bytes,prefix)=>bytes.length>=prefix.length&&prefix.every((v,i)=>bytes[i]===v);
// Explicit saved opt-in only. One shared socket dispatches at most sixteen
// already permitted peers. Discovery never enrolls or grants permission.
export async function openRelaySharingService({wasm,store,expectedGroup,member,generationAware=false,storage,locks,
  signal,onSaved=()=>{},onStatus=()=>{},transportFactory}) {
  if(!(expectedGroup instanceof Uint8Array)||expectedGroup.length!==32||!/^[0-9a-f]{64}$/.test(member))throw Error('Relay sharing context unavailable');
  const group=expectedGroup.slice(),options={wasm,store,expectedGroup:group,member};
  // Current R2 hive binding; the archived greeting relay is no longer the default.
  transportFactory??=createHiveRelayTransportFactory(options);
  const saved=await readRelayConfiguration(options);
  if(!saved.enabled||!saved.url)return null;
  let closed=false,connected=false,transport,watchTimer,announceTimer,announcement,permissionRevision,membershipRevision,networkGeneration=0;
  let incoming=Promise.resolve(),outgoing=Promise.resolve(),pendingIn=0,pendingOut=0;
  const peers=new Map(),lifetime=new AbortController();
  const status=(state,peer)=>{try{onStatus({state,peer});}catch{}};
  const close=()=>{
    if(closed)return;closed=true;networkGeneration++;lifetime.abort();signal?.removeEventListener('abort',close);
    clearTimeout(watchTimer);clearTimeout(announceTimer);for(const entry of peers.values())entry.connection?.close();peers.clear();transport?.disconnect();status('stopped');
  };
  const current=()=>{if(closed||signal?.aborted)throw Error('Relay sharing stopped');};
  const guard=async()=>{
    current();const latest=await readRelayConfiguration(options);current();
    if(!latest.enabled||latest.revision!==saved.revision||latest.url!==saved.url){close();throw Error('Relay choice changed');}
  };
  const send=bytes=>{
    current();if(!connected||pendingOut>=64)throw Error('Relay output unavailable');
    const copy=bytes.slice(),n=networkGeneration;pendingOut++;
    outgoing=outgoing.then(async()=>{await guard();if(n!==networkGeneration||!connected)return;transport.send(copy);})
      .catch(()=>{if(!closed&&n===networkGeneration)close();}).finally(()=>{pendingOut--;copy.fill(0);});
  };
  const announce=()=>{
    clearTimeout(announceTimer);if(closed||!connected||!announcement)return;
    try{send(announcement);announceTimer=setTimeout(announce,10000);}catch{close();}
  };
  const dispatch=async(bytes,n)=>{
    await guard();if(n!==networkGeneration||!connected)return;
    if(bytes.length===304&&starts(bytes,discovery)){
      let hint;try{hint=await acceptRelayAnnouncement({...options,packet:bytes,signal:lifetime.signal});}catch{return;}
      current();if(n!==networkGeneration||!connected)return;
      const id=hex(hint.peer);if(peers.has(id)||peers.size>=16)return;
      const entry={active:false};peers.set(id,entry);
      try{
        entry.connection=await openRelayJourneyConnection({...options,peer:hint.peer,certificate:hint.certificate,url:saved.url,
          generationAware,storage,locks,signal:lifetime.signal,onSaved,
          onStatus:s=>{
            status(s,id);
            if((s==='peer-unavailable'||s==='sharing-unavailable')&&peers.get(id)===entry){
              peers.delete(id);entry.connection?.close();
            }
          },transportFactory:callbacks=>{
            entry.callbacks=callbacks;
            return {start(){entry.active=true;if(connected&&!closed)callbacks.onStatus('connected');},
              disconnect(){entry.active=false;callbacks.onStatus('disconnected');},send};
          }});
        if(closed||peers.get(id)!==entry){entry.connection.close();return;}announce();
      }catch{entry.connection?.close();if(peers.get(id)===entry)peers.delete(id);status('peer-unavailable',id);}
    }else if(bytes.length>=138&&bytes.length<=2286&&starts(bytes,application)){
      if(hex(bytes.subarray(41,73))!==member)return;
      const entry=peers.get(hex(bytes.subarray(9,41)));if(entry?.active)entry.callbacks.onFrame(bytes);
    }
  };
  const watch=async()=>{
    try{
      await guard();const permission=await readJourneyPermission(options);current();
      if(permission.member!==member)throw Error('Relay identity changed');
      const membership=await store.read('membership',hex(group));current();
      if(!membership)throw Error('Relay membership unavailable');
      const membershipChanged=membership.revision!==membershipRevision;
      if(permission.revision!==permissionRevision||membershipChanged){
        permissionRevision=permission.revision;membershipRevision=membership.revision;
        // Discard queued frames from the prior authority and renew the signed
        // discovery certificate as well as each peer's audited session.
        networkGeneration++;clearTimeout(announceTimer);announcement=undefined;
        // Every held handshake audits this record, including changes to other
        // peers. Reopen all sessions with current authority after discovery.
        const previous=[...peers];peers.clear();
        for(const [id,entry] of previous){entry.connection?.close();status(permission.peers.includes(id)?(membershipChanged?'membership-changed':'permission-changed'):'permission-removed',id);}
        if(connected){
          const n=networkGeneration,value=await createRelayAnnouncement({...options,signal:lifetime.signal});
          await guard();if(n===networkGeneration&&connected){announcement=value;announce();}
        }
      }
      watchTimer=setTimeout(()=>{void watch();},1000);
    }catch{close();}
  };
  signal?.addEventListener('abort',close,{once:true});
  try{
    await guard();const permission=await readJourneyPermission(options);current();
    if(permission.member!==member)throw Error('Relay identity changed');
    permissionRevision=permission.revision;
    membershipRevision=(await store.read('membership',hex(group)))?.revision;current();
    if(membershipRevision===undefined)throw Error('Relay membership unavailable');
    transport=transportFactory({url:saved.url,
      createHello:async()=>{await guard();const hello=await createLocalRelayHello({...options,signal:lifetime.signal});await guard();if(JSON.parse(hello).device_id!==member)throw Error('Relay identity changed');return hello;},
      onStatus:s=>{
        if(closed)return;connected=s==='connected';const n=++networkGeneration;clearTimeout(announceTimer);announcement=undefined;
        for(const entry of peers.values())if(entry.active)entry.callbacks.onStatus(s);
        status('relay-'+s);
        if(connected)void (async()=>{await guard();const value=await createRelayAnnouncement({...options,signal:lifetime.signal});await guard();if(n===networkGeneration&&connected){announcement=value;announce();}})().catch(()=>{if(!closed&&n===networkGeneration)close();});
      },onFrame:bytes=>{
        if(closed||!connected||pendingIn>=32)return;
        const copy=bytes.slice(),n=networkGeneration;pendingIn++;
        incoming=incoming.then(()=>dispatch(copy,n)).catch(()=>{if(!closed&&n===networkGeneration)close();}).finally(()=>{pendingIn--;copy.fill(0);});
      }});
    current();transport.start();void watch();
    return Object.freeze({close,signal:lifetime.signal,url:saved.url,
      async synchronize(){await guard();return Promise.allSettled([...peers.values()].filter(e=>e.connection).map(e=>e.connection.synchronize()));}});
  }catch(error){close();throw error;}
}
