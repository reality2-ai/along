// Along browser-subset application envelope, NOT normative R2-WIRE.
// Caller MUST authenticate the session transcript and peer and enforce current
// membership/consent. sessionSecret must be fresh pairwise key material from
// that authenticated session, never a shared TG key or AT credential.
const fixed=(v,n)=>v instanceof Uint8Array && v.length===n;
const equal=(a,b)=>a.every((v,i)=>v===b[i]);
const encoder=new TextEncoder();
const concat=(...parts)=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;};
const u64=n=>{const b=new Uint8Array(8);new DataView(b.buffer).setBigUint64(0,n,false);return b;};
const MAX=2048;
export async function createRelayProtection({sessionSecret,group,epoch,local,peer,transcript,sign,check}) {
  if(!fixed(sessionSecret,32)||!fixed(group,32)||!fixed(local,32)||!fixed(peer,32)||equal(local,peer)
      ||!fixed(transcript,32)||!transcript.some(Boolean)||typeof epoch!=='bigint'||epoch<0n||epoch>0xffffffffffffffffn
      ||typeof sign!=='function'||typeof check!=='function')throw Error('Relay protection context unavailable');
  const salt=transcript.slice(),context=concat(group,u64(epoch),salt),me=local.slice(),other=peer.slice(),secret=sessionSecret.slice();
  let closed=false,sendKey,receiveKey,verifyKey,sent=0n,received=0n,sending=false,receiving=false;
  const close=()=>{closed=true;sendKey=receiveKey=verifyKey=undefined;};
  const current=async()=>{if(closed)throw Error('Relay protection closed');await check();if(closed)throw Error('Relay protection closed');};
  const binding=(from,to)=>concat(encoder.encode('along/relay/application/v1\0'),context,from,to);
  const outbound=binding(me,other),inbound=binding(other,me);
  try {
    await current();
    const material=await crypto.subtle.importKey('raw',secret,'HKDF',false,['deriveKey']);
    sendKey=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt,info:outbound},material,{name:'AES-GCM',length:256},false,['encrypt']);
    receiveKey=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt,info:inbound},material,{name:'AES-GCM',length:256},false,['decrypt']);
    verifyKey=await crypto.subtle.importKey('raw',other,'Ed25519',false,['verify']);await current();
  }catch(error){close();throw error;}finally{secret.fill(0);}
  const seal=async value=>{
    if(sending)throw Error('Relay send already pending');sending=true;let input;
    try{
      if(!(value instanceof Uint8Array)||value.length<1||value.length>MAX||sent===0xffffffffffffffffn)throw Error('Relay payload unavailable');
      input=value.slice();await current();const sequence=u64(++sent),iv=crypto.getRandomValues(new Uint8Array(12));
      const header=concat(new Uint8Array([1]),sequence,iv),aad=concat(outbound,header);
      const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad,tagLength:128},sendKey,input));
      await current();const body=concat(header,ciphertext);
      const signature=await sign(concat(outbound,body));await current();
      if(!fixed(signature,64))throw Error('Relay signature unavailable');
      return concat(body,signature);
    }catch(error){close();throw error;}finally{input?.fill(0);sending=false;}
  };
  const open=async packet=>{
    if(receiving)throw Error('Relay receive already pending');receiving=true;let input,output;
    try{
      if(!(packet instanceof Uint8Array)||packet.length<102||packet.length>MAX+101)throw Error('Relay frame unavailable');
      input=packet.slice();await current();const header=input.subarray(0,21),body=input.subarray(0,-64);
      const sequence=new DataView(input.buffer).getBigUint64(1,false);
      if(header[0]!==1||received===0xffffffffffffffffn||sequence!==received+1n)throw Error('Relay sequence unavailable');
      if(!await crypto.subtle.verify('Ed25519',verifyKey,input.subarray(-64),concat(inbound,body)))throw Error('Relay sender refused');
      await current();
      output=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:header.subarray(9),additionalData:concat(inbound,header),tagLength:128},receiveKey,input.subarray(21,-64)));
      await current();received=sequence;return output;
    }catch(error){output?.fill(0);close();throw error;}finally{input?.fill(0);receiving=false;}
  };
  return Object.freeze({seal,open,close});
}
