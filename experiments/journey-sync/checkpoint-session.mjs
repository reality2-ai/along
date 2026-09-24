// Explicit checkpoint channel. Authenticated receipt means retained for review,
// never installed. The enclosing UI supplies trusted peer selection/signaling.
import {openLocalPersonaSession} from '../tg-pairing/local-persona-session.mjs';
import {openPermittedJourneys,readJourneyPermission} from './permission.mjs';
import {retainPermittedJourneyCheckpoint} from './checkpoint-permission.mjs';
import {createCheckpointExchange} from './checkpoint-exchange.mjs';
import {validateGenerationState} from './generation-state.mjs';
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const fail=()=>new Error('Checkpoint connection unavailable; retention may already have occurred');
export async function openCheckpointSession({wasm,store,expectedGroup,peer,certificate,role,signal,timeoutMs,onRetained=()=>{}}) {
  if(!(expectedGroup instanceof Uint8Array)||expectedGroup.length!==32
      ||!(peer instanceof Uint8Array)||peer.length!==32
      ||!(certificate instanceof Uint8Array)||certificate.length!==136)throw fail();
  const group=expectedGroup.slice(),selected=peer.slice(),proof=certificate.slice(),groupId=hex(group);
  const lifetime=new AbortController();
  let session,exchange,closed=false,queue=Promise.resolve();
  const close=()=>{
    if(closed)return;
    closed=true;lifetime.abort();signal?.removeEventListener('abort',close);exchange?.close();session?.close();
  };
  const active=()=>{if(closed)throw fail();};
  signal?.addEventListener('abort',close,{once:true});if(signal?.aborted)close();
  try {
    active();
    const context={wasm,store,expectedGroup:group,peer:selected};
    const permitted=await openPermittedJourneys(context);
    const consent=await readJourneyPermission(context);
    const initial=await store.read('along-saved-journeys-v2',groupId);
    if(!initial)throw fail();
    const held=validateGenerationState(initial.value,groupId);
    const current=async()=>{
      active();await permitted.check();
      if((await readJourneyPermission(context)).revision!==consent.revision)throw fail();
      const record=await store.read('along-saved-journeys-v2',groupId);
      if(!record)throw fail();
      const state=validateGenerationState(record.value,groupId);
      if(state.generation!==held.generation||state.checkpoint!==held.checkpoint)throw fail();
      active();
    };
    await current();
    session=await openLocalPersonaSession({...context,role,signal:lifetime.signal,
      onMessage:async packet=>{await current();await exchange.receive(packet);}});
    if(closed){session.close();active();}
    session.signal.addEventListener('abort',close,{once:true});if(session.signal.aborted)close();
    active();
    exchange=createCheckpointExchange({group:groupId,timeoutMs,signal:lifetime.signal,onClose:close,
      send:async packet=>{await current();await session.send(packet);},
      retain:async(bundle,{signal:transferSignal})=>{
        await current();
        const receipt=await retainPermittedJourneyCheckpoint({...context,certificate:proof,...bundle,signal:transferSignal});
        await current();
        try{onRetained(receipt);}catch{}
        return receipt;
      }});
    return Object.freeze({
      peer:hex(selected),
      offer:()=>{active();return session.offer();},
      accept:description=>{active();return session.accept(description);},
      authenticated:async()=>{try{await session.authenticated();await current();}catch(error){close();throw error;}},
      sendCheckpoint(bundle){
        const copy=structuredClone(bundle);
        const operation=queue.then(async()=>{
          await session.authenticated();await current();return exchange.sendCheckpoint(copy);
        }).catch(error=>{close();throw error;});
        queue=operation.catch(()=>{});return operation;
      },
      close,signal:lifetime.signal,
    });
  }catch{close();throw fail();}
}
