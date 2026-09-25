import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {openLocalRelayHandshake} from './local-handshake.mjs';
import {createLocalRelayHello} from './local-hello.mjs';
import {createHiveRelayTransportFactory} from '../r2-current/hive-relay-transport.mjs';
import {createRelayPeerLifecycle} from './peer-lifecycle.mjs';
import {openPermittedJourneys} from '../journey-sync/permission.mjs';
import {openPermittedGenerationJourneys} from '../journey-sync/generation-permission.mjs';
import {createJourneyExchange} from '../journey-sync/exchange.mjs';
import {createGenerationJourneyExchange} from '../journey-sync/generation-exchange.mjs';
const hex=b=>Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');
// One explicit selected relay + already enrolled, consenting peer. Reconnect
// refreshes authority and snapshot state. Never grants access or imports history.
export async function openRelayJourneyConnection({wasm,store,expectedGroup,peer,certificate,url,
  generationAware=false,storage,locks,signal,onSaved=()=>{},onStatus=()=>{},
  transportFactory}) {
  if(!(expectedGroup instanceof Uint8Array)||expectedGroup.length!==32||!(peer instanceof Uint8Array)||peer.length!==32
      ||!(certificate instanceof Uint8Array)||certificate.length!==136||typeof generationAware!=='boolean')throw Error('Relay journey context unavailable');
  const group=expectedGroup.slice(),remote=peer.slice(),proof=certificate.slice(),lifetime=new AbortController();
  let closed=false,transport,lifecycle,slot,revision=0,sendQueue=Promise.resolve(),pending=0;
  const status=s=>{try{onStatus(s);}catch{}};
  const discard=()=>{revision++;const old=slot;slot=undefined;old?.exchange?.close();};
  const close=()=>{if(closed)return;closed=true;lifetime.abort();signal?.removeEventListener('abort',close);discard();lifecycle?.close();transport?.disconnect();};
  const current=()=>{if(closed||signal?.aborted)throw Error('Relay journeys ended');};
  signal?.addEventListener('abort',close,{once:true});
  try{
    current();const identity=await loadLocalPersona({wasm,store,expectedGroup:group});current();
    if(!identity||identity.member===hex(remote))throw Error('Relay peer unavailable');
    const local=Uint8Array.from(identity.member.match(/../g),b=>parseInt(b,16));
    const role=identity.member<hex(remote)?'offer':'answer';
    const valid=held=>{current();if(slot!==held||held.version!==revision)throw Error('Relay journey session changed');};
    const wireSend=(held,packet)=>{
      if(pending>=32)return Promise.reject(Error('Relay send queue full'));
      const copy=packet.slice();pending++;
      const operation=sendQueue.then(async()=>{valid(held);await held.journeys.check();valid(held);await lifecycle.send(copy);});
      sendQueue=operation.catch(()=>{});return operation.finally(()=>{pending--;copy.fill(0);});
    };
    const synchronize=async()=>{
      current();const held=slot;if(!held?.exchange)throw Error('Relay peer not connected');valid(held);
      if(held.sync){held.again=true;return held.sync;}
      held.sync=(async()=>{let receipt;do{held.again=false;const snapshot=await held.journeys.snapshot();valid(held);receipt=await held.exchange.sendSnapshot(snapshot);valid(held);status('peer-saved-snapshot');}while(held.again);return receipt;})().finally(()=>{held.sync=undefined;});
      return held.sync;
    };
    lifecycle=createRelayPeerLifecycle({local,peer:remote,
      openHandshake:async sessionSignal=>{
        discard();const n=revision;
        const options={wasm,store,expectedGroup:group,peer:remote,certificate:proof,storage,locks};
        const journeys=await (generationAware?openPermittedGenerationJourneys:openPermittedJourneys)(options);current();
        const handshake=await openLocalRelayHandshake({...options,role,signal:sessionSignal});
        if(closed||sessionSignal.aborted||revision!==n){handshake.close();throw Error('Relay journey setup replaced');}
        slot={version:n,journeys,sessionSignal};return handshake;
      },send:frame=>{current();transport.send(frame);},
      onMessage:async packet=>{const held=slot;valid(held);if(!held?.exchange)throw Error('Relay snapshot channel unavailable');await held.journeys.check();valid(held);await held.exchange.receive(packet);},
      onStatus:s=>{
        if(closed)return;
        if(s==='peer-connected'){
          const held=slot;if(!held)return;
          held.exchange=(generationAware?createGenerationJourneyExchange:createJourneyExchange)({group:hex(group),version:held.journeys.version,
            signal:held.sessionSignal,send:packet=>wireSend(held,packet),
            commit:async(snapshot,options)=>{valid(held);const receipt=await held.journeys.merge(snapshot,options);try{onSaved();}catch{}return receipt;},
            onClose:()=>{if(slot===held&&!closed){discard();if(!held.sessionSignal.aborted){lifecycle.disconnected();status('sharing-unavailable');}}}});
          status(s);void synchronize().catch(()=>{if(slot===held){discard();lifecycle.disconnected();status('sharing-unavailable');}});
        }else{if(s==='disconnected'||s==='peer-unavailable')discard();status(s);}
      }});
    transportFactory??=createHiveRelayTransportFactory({wasm,store,expectedGroup:group,member:identity.member});
    transport=transportFactory({url,createHello:()=>createLocalRelayHello({wasm,store,expectedGroup:group,signal:lifetime.signal}),
      onFrame:frame=>lifecycle.receive(frame),onStatus:s=>{
        if(closed)return;if(s==='connected')lifecycle.connected();else lifecycle.disconnected();status('relay-'+s);
      }});
    current();transport.start();
    return Object.freeze({synchronize,close,signal:lifetime.signal,peer:hex(remote)});
  }catch(error){close();throw error;}
}
