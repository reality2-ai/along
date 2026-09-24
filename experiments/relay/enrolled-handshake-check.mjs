// Called by the actual enrollment browser fixture. Message transfer is harness
// carriage here; real network relay composition is checked separately.
import {openLocalRelayHandshake} from './local-handshake.mjs';
import {readJourneyPermission,setJourneyPermission} from '../journey-sync/permission.mjs';
export async function checkEnrolledRelayHandshake({wasm,owner,receiver,group}) {
  const check=(v,why)=>{if(!v)throw Error(why);};
  const denied=fn=>fn().then(()=>false,()=>true);
  const options=[{wasm,store:owner.store,expectedGroup:group,peer:receiver.subject,certificate:receiver.certificate,role:'offer'},
    {wasm,store:receiver.store,expectedGroup:group,peer:owner.subject,certificate:owner.certificate,role:'answer'}];
  const allow=async(i,value)=>{
    const p=await readJourneyPermission(options[i]);
    await setJourneyPermission({...options[i],allow:value,expectedRevision:p.revision});
  };
  await allow(0,false);await allow(1,false);
  check(await denied(()=>openLocalRelayHandshake(options[0])),'no relay handshake without explicit journey consent');
  await allow(0,true);await allow(1,true);
  const a=await openLocalRelayHandshake(options[0]),b=await openLocalRelayHandshake(options[1]);
  try{
    const [ac,bc]=await Promise.all([a.contribution(),b.contribution()]);
    const [af,bf]=await Promise.all([a.accept(bc),b.accept(ac)]);
    const [left,right]=await Promise.all([a.confirm(bf),b.confirm(af)]);
    const bytes=new TextEncoder().encode('synthetic enrolled saved places');
    check(new TextDecoder().decode(await right.open(await left.seal(bytes)))==='synthetic enrolled saved places','enrolled pair decrypts protected bytes');
    await allow(0,false);await allow(0,true);
    check(await denied(()=>left.seal(bytes))&&left.signal.aborted,'regrant cannot revive earlier relay session');
  }finally{a.close();b.close();}
  const stale=await openLocalRelayHandshake(options[0]);
  try{
    const held=await owner.store.read('candidate-persona','active');
    check((await owner.store.compareAndSwap('candidate-persona','active',held.revision,held.value)).applied,'fixture identity revision changed');
    check(await denied(()=>stale.contribution()),'concurrent identity replacement refuses held handshake');
  }finally{stale.close();}
  const wrong=receiver.certificate.slice();wrong[0]^=1;
  check(await denied(()=>openLocalRelayHandshake({...options[0],certificate:wrong})),'invalid peer certificate refused');
  await allow(0,false);await allow(1,false);
}
