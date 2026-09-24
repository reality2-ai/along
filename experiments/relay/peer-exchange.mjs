// One selected peer, one fresh handshake. Transport reconnection must create a
// new instance. Routing fields are hints; the handshake/protection authenticates.
const magic=new TextEncoder().encode('ALNRLY01'),HEADER=137,MAX=2149;
const fixed=(b,n)=>b instanceof Uint8Array&&b.length===n;
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
export function readRelayAddressedPacket(value,local,peer) {
  if(!(value instanceof Uint8Array)||value.length<HEADER+1||value.length>HEADER+MAX
      ||!same(value.subarray(0,8),magic)||![1,2,3].includes(value[8])
      ||!same(value.subarray(9,41),peer)||!same(value.subarray(41,73),local))return null;
  const copy=value.slice();return {bytes:copy,kind:copy[8],nonce:copy.slice(73,105),target:copy.slice(105,137),payload:copy.slice(HEADER)};
}
export async function createRelayPeerExchange({handshake,local,peer,send,onMessage,onReady=()=>{},timers=globalThis}) {
  if(!fixed(local,32)||!fixed(peer,32)||same(local,peer)||typeof send!=='function'||typeof onMessage!=='function')throw Error('Relay exchange unavailable');
  const me=local.slice(),other=peer.slice();
  let closed=false,started=false,channel,remoteContribution,remoteNonce,confirmation,peerConfirmation,retry,pending=0,queue=Promise.resolve();
  let resolve,reject;const ready=new Promise((yes,no)=>{resolve=yes;reject=no;});void ready.catch(()=>{});
  const close=()=>{if(closed)return;closed=true;timers.clearTimeout(retry);handshake.signal.removeEventListener('abort',close);handshake.close();reject(Error('Relay exchange ended'));};
  handshake.signal.addEventListener('abort',close,{once:true});
  let contribution;
  try{contribution=await handshake.contribution();if(handshake.signal.aborted)throw Error('Relay handshake ended');}
  catch(error){close();throw error;}
  const nonce=contribution.slice(1,33);
  const packet=(kind,payload,target=remoteNonce)=>{
    const bytes=new Uint8Array(HEADER+payload.length);bytes.set(magic);bytes[8]=kind;
    bytes.set(me,9);bytes.set(other,41);bytes.set(nonce,73);if(target)bytes.set(target,105);bytes.set(payload,HEADER);return bytes;
  };
  const write=(kind,payload,target)=>{if(closed)throw Error('Relay exchange ended');send(packet(kind,payload,target));};
  const announce=()=>{write(1,contribution,new Uint8Array(32));if(confirmation)write(2,confirmation);};
  const repeat=()=>{
    if(closed||channel)return;
    try{announce();retry=timers.setTimeout(repeat,1000);}catch{close();}
  };
  const process=async bytes=>{
    if(closed)return;
    const kind=bytes[8],senderNonce=bytes.subarray(73,105),targetNonce=bytes.subarray(105,137),payload=bytes.subarray(HEADER);
    if(kind===1){
      if(payload.length!==129||!same(senderNonce,payload.subarray(1,33))||targetNonce.some(Boolean))return;
      if(remoteContribution){
        if(same(payload,remoteContribution)){
          // Retry the exact protected confirmation, never consume another crypto
          // sequence. A reconnect with another nonce requires a new controller.
          if(confirmation)write(2,confirmation);
        }
        return;
      }
      confirmation=await handshake.accept(payload);if(closed)return;
      remoteContribution=payload.slice();remoteNonce=senderNonce.slice();write(2,confirmation);
    }else{
      if(!remoteNonce||!same(senderNonce,remoteNonce)||!same(targetNonce,nonce))return;
      if(kind===2){
        if(peerConfirmation){if(!same(payload,peerConfirmation))throw Error('Conflicting relay confirmation');return;}
        channel=await handshake.confirm(payload);if(closed)return;
        peerConfirmation=payload.slice();timers.clearTimeout(retry);resolve();onReady();
      }else if(kind===3&&channel){
        const plaintext=await channel.open(payload);
        try{if(!closed)await onMessage(plaintext,handshake.signal);}finally{plaintext.fill(0);}
      }
    }
  };
  return Object.freeze({ready,signal:handshake.signal,close,
    start(){if(started||closed)return;started=true;repeat();},
    receive(value){
      if(closed||!started||!(value instanceof Uint8Array)||value.length<HEADER+1||value.length>HEADER+MAX
          ||!same(value.subarray(0,8),magic)||![1,2,3].includes(value[8])
          ||!same(value.subarray(9,41),other)||!same(value.subarray(41,73),me))return;
      if(pending>=32){close();return;}pending++;
      const copy=value.slice();queue=queue.then(()=>process(copy)).catch(close).finally(()=>{pending--;copy.fill(0);});
    },
    async send(value){
      if(closed||!channel)throw Error('Relay peer not ready');
      try{const encrypted=await channel.seal(value);write(3,encrypted);}
      catch(error){close();throw error;}
    },
  });
}
