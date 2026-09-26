// Ephemeral inner protection for recovery. Invitation possession alone must not
// reveal replacement traffic keys. Existing mutual signatures authenticate this
// exchange's transcript (including both ECDH public keys) before any update.
const hex = bytes => Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const unhex = text => Uint8Array.from(text.match(/../g),b=>parseInt(b,16));
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8',{fatal:true});
export function createRecoveryProtection(role) {
  let pair, sendKey, receiveKey, binding, stopped = false, nextSend = 0, nextReceive = 0;
  const current = () => { if (stopped) throw Error('Recovery protection ended'); };
  const close = () => { stopped=true; pair=sendKey=receiveKey=binding=undefined; };
  const iv = n => { const bytes=new Uint8Array(12);new DataView(bytes.buffer).setUint32(8,n);return bytes; };
  return Object.freeze({close,
    async publicKey() {
      current(); if(pair)throw Error('Recovery contribution already created');
      const created=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
      current();pair=created;return hex(new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey)));
    },
    async bind(remotePublic, transcript) {
      current();if(!pair || sendKey || receiveKey)throw Error('Recovery protection unavailable');
      let shared, material;
      try {
        const remote=await crypto.subtle.importKey('raw',unhex(remotePublic),{name:'ECDH',namedCurve:'P-256'},false,[]);
        shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:remote},pair.privateKey,256));current();
        const key=await crypto.subtle.importKey('raw',shared,'HKDF',false,['deriveBits']);
        material=new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt:transcript,
          info:encoder.encode('along/epoch-recovery/inner/v1')},key,512));current();
        const keys=await Promise.all([0,32].map(at=>crypto.subtle.importKey('raw',material.subarray(at,at+32),'AES-GCM',false,['encrypt','decrypt'])));
        current();[sendKey,receiveKey]=role==='offer'?keys:[keys[1],keys[0]];binding=transcript.slice();pair=undefined;
      } finally {shared?.fill(0);material?.fill(0);}
    },
    async protect(text) {
      current();if(!sendKey || nextSend>=32)throw Error('Recovery send unavailable');
      const n=nextSend++, clear=encoder.encode(text);
      try {
        const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:iv(n),additionalData:binding},sendKey,clear));
        current();return JSON.stringify({n,ciphertext:btoa(String.fromCharCode(...encrypted))});
      } finally {clear.fill(0);}
    },
    async open(text) {
      current();if(!receiveKey || nextReceive>=32 || typeof text!=='string' || text.length>16384)throw Error('Recovery receive unavailable');
      const frame=JSON.parse(text);
      if(!frame || Array.isArray(frame) || Object.keys(frame).sort().join(',')!=='ciphertext,n'
          || frame.n!==nextReceive || typeof frame.ciphertext!=='string')throw Error('Invalid recovery ciphertext');
      const raw=atob(frame.ciphertext);
      if(btoa(raw)!==frame.ciphertext)throw Error('Invalid recovery ciphertext');
      const encrypted=Uint8Array.from(raw,c=>c.charCodeAt(0));
      const clear=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:iv(frame.n),additionalData:binding},receiveKey,encrypted));
      try {current();nextReceive++;return decoder.decode(clear);} finally {clear.fill(0);}
    },
  });
}
