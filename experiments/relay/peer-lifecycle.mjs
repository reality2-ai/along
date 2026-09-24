import {createRelayPeerExchange,readRelayAddressedPacket} from './peer-exchange.mjs';
const hex=b=>Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');
// One selected enrolled peer across transport reconnects. openHandshake must
// re-read actual local membership and consent, and honor its supplied signal.
export function createRelayPeerLifecycle({local,peer,openHandshake,send,onMessage,onStatus=()=>{}}) {
  if(!(local instanceof Uint8Array)||local.length!==32||!(peer instanceof Uint8Array)||peer.length!==32
      ||typeof openHandshake!=='function'||typeof send!=='function'||typeof onMessage!=='function')throw Error('Relay lifecycle unavailable');
  const me=local.slice(),other=peer.slice(),seen=new Set();
  let online=false,disposed=false,version=0,opening,handshake,exchange,scope,remoteNonce,pending=0,queue=Promise.resolve();
  const status=s=>{try{onStatus(s);}catch{}};
  const end=()=>{version++;scope?.abort();exchange?.close();handshake?.close();exchange=handshake=undefined;scope=undefined;remoteNonce=undefined;};
  const current=n=>!disposed&&online&&version===n;
  const replace=async()=>{
    end();const n=version;scope=new AbortController();const signal=scope.signal;status('connecting-peer');
    let held,created;
    try{
      held=await openHandshake(signal);
      if(!current(n)){held.close();return false;}handshake=held;
      created=await createRelayPeerExchange({handshake:held,local:me,peer:other,
        send:b=>{if(!current(n))throw Error('Relay connection changed');send(b);},
        onMessage:async(b,s)=>{if(current(n))await onMessage(b,s);},onReady:()=>{if(current(n))status('peer-connected');}});
      if(!current(n)){created.close();return false;}
      exchange=created;
      created.signal.addEventListener('abort',()=>{if(current(n)){end();status('peer-unavailable');}},{once:true});
      if(created.signal.aborted){end();status('peer-unavailable');return false;}
      void created.ready.catch(()=>{if(current(n)){end();status('peer-unavailable');}});
      created.start();return true;
    }catch(error){held?.close();created?.close();if(current(n)){end();status('peer-unavailable');}return false;}
  };
  const receive=async(frame,n)=>{
    await opening;if(!current(n)||!handshake||!exchange)return;
    if(frame.kind===1){
      if(frame.payload.length!==129||frame.target.some(Boolean)||hex(frame.nonce)!==hex(frame.payload.subarray(1,33)))return;
      const id=hex(frame.nonce);
      if(id!==remoteNonce){
        if(seen.has(id))return;
        // Never let an unsigned outer routing nonce replace a live session.
        try{await handshake.inspect(frame.payload);}catch{return;}
        if(!current(n))return;
        if(seen.size>=64){end();status('peer-unavailable');return;}
        if(remoteNonce){opening=replace();if(!await opening)return;n=version;}
        if(!current(n))return;remoteNonce=id;seen.add(id);
      }
    }
    exchange.receive(frame.bytes);
  };
  return Object.freeze({
    connected(){if(disposed)return;online=true;opening=replace();},
    disconnected(){if(disposed)return;online=false;end();status('disconnected');},
    receive(value){
      if(disposed||!online)return;const frame=readRelayAddressedPacket(value,me,other);if(!frame)return;
      if(pending>=32){end();status('peer-unavailable');return;}
      const n=version;pending++;queue=queue.then(()=>receive(frame,n)).catch(()=>{if(current(n)){end();status('peer-unavailable');}}).finally(()=>{pending--;frame.bytes.fill(0);frame.payload.fill(0);});
    },
    async send(value){if(disposed||!online||!exchange)throw Error('Relay peer unavailable');await exchange.send(value);},
    close(){if(disposed)return;disposed=true;online=false;end();status('disconnected');},
  });
}
