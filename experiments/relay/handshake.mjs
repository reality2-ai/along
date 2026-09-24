// Experimental Along application handshake. Caller supplies an already selected
// peer and a check enforcing its certificate, epoch and application permission.
// Does not enroll peers or implement normative R2-WIRE. No public data sent here.
import {createRelayProtection} from './protection.mjs';
const fixed=(v,n)=>v instanceof Uint8Array&&v.length===n;
const concat=(...parts)=>{const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){b.set(p,at);at+=p.length;}return b;};
const encoder=new TextEncoder(),confirmation=encoder.encode('along/relay/confirmed/v1');
export async function createRelayHandshake({role,group,epoch,local,peer,sign,check,signal}) {
  if(!['offer','answer'].includes(role)||!fixed(group,32)||!fixed(local,32)||!fixed(peer,32)
      ||local.every((b,i)=>b===peer[i])||typeof epoch!=='bigint'||epoch<0n||epoch>0xffffffffffffffffn
      ||typeof sign!=='function'||typeof check!=='function')throw Error('Relay handshake context unavailable');
  const me=local.slice(),other=peer.slice(),root=group.slice(),epochBytes=new Uint8Array(8);
  new DataView(epochBytes.buffer).setBigUint64(0,epoch,false);
  const initiator=role==='offer'?me:other,responder=role==='offer'?other:me;
  const context=concat(encoder.encode('along/relay/handshake/v1\0'),root,epochBytes,initiator,responder);
  let pair,own,protection,closed=false,busy=false,phase='new',timer;
  const lifetime=new AbortController();
  const close=()=>{closed=true;phase='closed';clearTimeout(timer);pair=undefined;protection?.close();signal?.removeEventListener('abort',close);lifetime.abort();};
  const current=async()=>{if(closed||signal?.aborted)throw Error('Relay handshake ended');await check();if(closed||signal?.aborted)throw Error('Relay handshake ended');};
  signal?.addEventListener('abort',close,{once:true});
  try{
    await current();pair=await crypto.subtle.generateKey('X25519',false,['deriveBits']);await current();
    const pub=new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey));
    own=concat(new Uint8Array([role==='offer'?1:2]),crypto.getRandomValues(new Uint8Array(32)),pub);
    await current();timer=setTimeout(close,60000);
  }catch(error){close();throw error;}
  const run=async(next,operation)=>{
    if(busy)throw Error('Relay handshake operation pending');busy=true;
    try{await current();if(phase!==next)throw Error('Unexpected relay handshake step');return await operation();}
    catch(error){close();throw error;}finally{busy=false;}
  };
  return Object.freeze({
    contribution:()=>run('new',async()=>{
      const signature=await sign(concat(context,own));await current();
      if(!fixed(signature,64))throw Error('Relay handshake signature unavailable');
      phase='sent';return concat(own,signature);
    }),
    accept:value=>{
      // Snapshot before any callback can yield control to the caller.
      const packet=fixed(value,129)?value.slice():null;
      return run('sent',async()=>{
        if(!packet||packet[0] !== (role==='offer'?2:1))throw Error('Invalid relay contribution');
        const body=packet.slice(0,65),key=await crypto.subtle.importKey('raw',other,'Ed25519',false,['verify']);
        if(!await crypto.subtle.verify('Ed25519',key,packet.subarray(65),concat(context,body)))throw Error('Relay peer signature refused');
        await current();
        const remote=await crypto.subtle.importKey('raw',body.subarray(33),'X25519',false,[]);
        const transcript=new Uint8Array(await crypto.subtle.digest('SHA-256',concat(context,...(role==='offer'?[own,body]:[body,own]))));
        let secret;
        try{
          secret=new Uint8Array(await crypto.subtle.deriveBits({name:'X25519',public:remote},pair.privateKey,256));pair=undefined;
          await current();
          protection=await createRelayProtection({sessionSecret:secret,group:root,epoch,local:me,peer:other,transcript,sign,check:current});
          await current();const reply=await protection.seal(confirmation);await current();phase='confirm';return reply;
        }finally{secret?.fill(0);}
      });
    },
    confirm:value=>{
      const packet=value instanceof Uint8Array&&value.length<=2149?value.slice():null;
      return run('confirm',async()=>{
        if(!packet)throw Error('Relay confirmation unavailable');
        const result=await protection.open(packet);
        try{if(result.length!==confirmation.length||!result.every((b,i)=>b===confirmation[i]))throw Error('Relay confirmation invalid');}
        finally{result.fill(0);}
        await current();phase='ready';clearTimeout(timer);
        const guarded=operation=>async value=>{try{return await operation(value);}catch(error){close();throw error;}};
        return Object.freeze({seal:guarded(protection.seal),open:guarded(protection.open),close,signal:lifetime.signal});
      });
    },
    close,signal:lifetime.signal,
  });
}
