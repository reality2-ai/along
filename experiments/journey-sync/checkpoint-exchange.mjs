// Dedicated authenticated-session payload. Receiving verifies the issuer's
// signature, but does not adopt its parent/generation or install application data.
// retain must check local ordering/consent and durably stage the reviewed input.
import {createBoundedExchange} from './exchange.mjs';
import {validateState} from './state.mjs';
import {verifyJourneyCheckpoint} from './generation-checkpoint.mjs';
const profile='along-journey-checkpoint-transfer-v1';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const fail=()=>new Error('Checkpoint transfer unconfirmed');
const exact=(value,keys)=>value&&Object.keys(value).sort().join(',')===keys;
export function createCheckpointExchange({group,retain,...options}) {
  if(!/^[0-9a-f]{64}$/.test(group)||typeof retain!=='function')throw fail();
  const copy=value=>{
    if(!exact(value,'checkpoint,snapshot')||!(value.checkpoint instanceof Uint8Array)||value.checkpoint.length!==184)throw fail();
    const snapshot=validateState(value.snapshot,group);
    if(snapshot.journeys.some(entry=>entry.value===null))throw fail();
    return {checkpoint:value.checkpoint.slice(),snapshot};
  };
  const exchange=createBoundedExchange({...options,frameBase:16,
    commitStatus:'checkpoint-retained-for-review',resultStatus:'peer-retained-checkpoint',
    encode:value=>{
      const held=copy(value);return encoder.encode(JSON.stringify({profile,checkpoint:hex(held.checkpoint),snapshot:held.snapshot}));
    },
    decode:async bytes=>{
      const value=JSON.parse(decoder.decode(bytes));
      if(!exact(value,'checkpoint,profile,snapshot')||value.profile!==profile||typeof value.checkpoint!=='string'
          ||!/^[0-9a-f]{368}$/.test(value.checkpoint))throw fail();
      const message=copy({checkpoint:Uint8Array.from(value.checkpoint.match(/../g),b=>parseInt(b,16)),snapshot:value.snapshot});
      const view=new DataView(message.checkpoint.buffer);
      // This reconstructs only the signed predecessor identifier, not evidence
      // that this device holds it. The durable inbox must compare its real state.
      await verifyJourneyCheckpoint({bytes:message.checkpoint,snapshot:message.snapshot,current:{format:2,group,
        generation:Number(view.getBigUint64(40)),checkpoint:hex(message.checkpoint.slice(56,88)),clock:0,journeys:[]}});
      return message;
    },
    commit:retain,
  });
  return Object.freeze({sendCheckpoint:exchange.sendPayload,receive:exchange.receive,close:exchange.close,signal:exchange.signal});
}
