// Browser test helper only: real WASM certificate verifier and IndexedDB custody.
import {createLocalRelayHello} from './local-hello.mjs';
export async function setupStoredHello() {
  const wasm=await import('../hive_wasm.js');await wasm.default();
  const {openBrowserStorage}=await import('../tg-pairing/storage.mjs');
  const {initializeSoftwarePersona}=await import('../tg-pairing/software-persona.mjs');
  const store=await openBrowserStorage('relay-stored-identity');
  let saved=await store.read('candidate-persona','active');
  if(!saved){await initializeSoftwarePersona({wasm,store});saved=await store.read('candidate-persona','active');}
  const group=saved.value.record.group.slice();
  window.relayFixture={wasm,store,group};
  window.localRelayIdentity=Array.from(saved.value.record.subject,b=>b.toString(16).padStart(2,'0')).join('');
  return ()=>createLocalRelayHello({wasm,store,expectedGroup:group});
}
export async function checkStoredHello() {
  const {wasm,store,group}=window.relayFixture;
  const check=(value,why)=>{if(!value)throw Error(why);};
  const denied=fn=>fn().then(()=>false,()=>true);
  const abort=new AbortController();abort.abort();
  check(await denied(()=>createLocalRelayHello({wasm,store,expectedGroup:group,signal:abort.signal})),'cancelled greeting');
  let reads=0,changed=false;
  const racing={...store,read:async(scope,key)=>{
    if(scope==='candidate-persona' && ++reads===2){
      const saved=await store.read(scope,key);
      const result=await store.compareAndSwap(scope,key,saved.revision,saved.value);
      check(result.applied,'fixture revision advance');changed=true;
    }
    return store.read(scope,key);
  }};
  check(await denied(()=>createLocalRelayHello({wasm,store:racing,expectedGroup:group})) && changed,'changed identity refuses held greeting');
  check(JSON.parse(await createLocalRelayHello({wasm,store,expectedGroup:group})).device_id===localRelayIdentity,'fresh reload of same identity');
  const originalVerify=crypto.subtle.verify;let verifications=0,lateChanged=false;
  crypto.subtle.verify=async function(...args){
    const result=await originalVerify.apply(this,args);
    if(++verifications===2){
      const key=Array.from(group,b=>b.toString(16).padStart(2,'0')).join('');
      const record=await store.read('membership',key);
      const written=await store.compareAndSwap('membership',key,record.revision,record.value);
      check(written.applied,'late membership fixture advance');lateChanged=true;
    }
    return result;
  };
  try {
    check(await denied(()=>createLocalRelayHello({wasm,store,expectedGroup:group})) && lateChanged,'membership change during final verification refuses');
  }finally{crypto.subtle.verify=originalVerify;}
  const {loadSoftwareIssuer}=await import('../tg-pairing/software-persona.mjs');
  const {openMembership}=await import('../tg-pairing/membership.mjs');
  const saved=await store.read('candidate-persona','active');
  const issuer=await loadSoftwareIssuer({wasm,store,expectedGroup:group});
  const membership=openMembership(store,wasm,group,saved.value.record.subject);
  try {
    // Synthetic self-revocation exercises cryptographic membership rejection;
    // the app's user-facing removal flow deliberately does not offer this action.
    const evidence=await issuer.issueRevocation({subject:saved.value.record.subject,sequence:1n,reason:0});
    await membership.applyRevocation(evidence);
    check(await denied(()=>createLocalRelayHello({wasm,store,expectedGroup:group})),'signed revocation refuses greeting');
  }finally{membership.close();issuer.close();store.close();}
}
