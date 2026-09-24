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
  const {openRelayJourneyConnection}=await import('./journey-connection.mjs');
  const {openJourneyStore}=await import('../journey-sync/store.mjs');
  const {projectJourney}=await import('../journey-sync/state.mjs');
  const hex=b=>Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');
  const replicas=[owner,receiver].map(device=>openJourneyStore({store:device.store,group:hex(group),actor:hex(device.subject)}));
  await replicas[0].save(projectJourney({from:{id:'relay-from',name:'Relay origin',lat:-36,lon:174},to:{id:'relay-to',name:'Relay destination',lat:-37,lon:175},savedRoutes:[{mode:'bus',route:'70'}]}));
  const transports=[],statuses=[[],[]],connections=[];
  const factory=i=>callbacks=>{
    let active=false;
    const transport={callbacks,get active(){return active;},start(){active=true;callbacks.onStatus('connected');},disconnect(){active=false;callbacks.onStatus('disconnected');},
      send(packet){if(!active)throw Error('Test relay disconnected');const copy=packet.slice();queueMicrotask(()=>{if(transports[1-i]?.active)transports[1-i].callbacks.onFrame(copy);});}};
    transports[i]=transport;return transport;
  };
  const wait=async predicate=>{for(let n=0;n<2000;n++){if(await predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('Relay journey fixture timed out: '+JSON.stringify(statuses));};
  try{
    for(let i=0;i<2;i++)connections[i]=await openRelayJourneyConnection({...options[i],url:globalThis.relayNetwork?location.origin.replace('https:','wss:')+'/r2':'wss://unused.example/r2',...(globalThis.relayNetwork?{}:{transportFactory:factory(i)}),onStatus:s=>statuses[i].push(s)});
    await wait(()=>statuses.every(list=>list.includes('peer-saved-snapshot')));
    check(JSON.stringify((await replicas[0].read()).state)===JSON.stringify((await replicas[1].read()).state),'relay snapshot receipt follows convergence');
    if(globalThis.relayNetwork){await window.dropRelayPeer(hex(owner.subject));await wait(()=>statuses[0].includes('relay-waiting'));}
    else transports[0].disconnect();
    await replicas[0].save(projectJourney({from:{id:'offline-from',name:'Offline origin',lat:-36,lon:174},to:{id:'offline-to',name:'Offline destination',lat:-37,lon:175},savedRoutes:[]}));
    if(!globalThis.relayNetwork)transports[0].start();
    await wait(()=>statuses.every(list=>list.filter(s=>s==='peer-saved-snapshot').length>=2));
    check(JSON.stringify((await replicas[0].read()).state)===JSON.stringify((await replicas[1].read()).state),'reconnection shares offline edit after fresh handshake');
    await allow(0,false);
    check(await denied(()=>connections[0].synchronize()),'removed consent stops replica send');
  }finally{connections.forEach(c=>c.close());}
  await allow(0,false);await allow(1,false);
}
