import {createRelayAnnouncement,acceptRelayAnnouncement} from './discovery.mjs';
import {readJourneyPermission,setJourneyPermission} from '../journey-sync/permission.mjs';
export async function checkRelayDiscovery({wasm,owner,receiver,group}) {
  const check=(v,why)=>{if(!v)throw Error(why);},denied=fn=>fn().then(()=>false,()=>true);
  const options={wasm,store:owner.store,expectedGroup:group,peer:receiver.subject,certificate:receiver.certificate};
  const grant=async allow=>setJourneyPermission({...options,allow,expectedRevision:(await readJourneyPermission(options)).revision});
  const packet=await createRelayAnnouncement({wasm,store:receiver.store,expectedGroup:group});
  check(packet.length===304,'bounded public announcement');
  const accept=(value=packet,extra={})=>acceptRelayAnnouncement({...options,packet:value,...extra});
  await grant(false);check(await denied(()=>accept()),'discovery does not grant consent');await grant(true);
  const hint=await accept();check(hint.status==='verified-discovery-hint'&&hint.peer.every((b,i)=>b===receiver.subject[i]),'correct enrolled peer discovered');
  check(hint.certificate.every((b,i)=>b===receiver.certificate[i]),'verified certificate returned for handshake');
  for(const index of [0,8,40,72,208,303]){const bad=packet.slice();bad[index]^=1;check(await denied(()=>accept(bad)),'tampered announcement refused');}
  const own=await createRelayAnnouncement({wasm,store:owner.store,expectedGroup:group});check(await denied(()=>accept(own)),'own announcement ignored');
  const abort=new AbortController();abort.abort();check(await denied(()=>accept(packet,{signal:abort.signal})),'cancelled discovery refused');
  const original=crypto.subtle.verify;let changed=false;
  crypto.subtle.verify=async function(...args){
    const result=await original.apply(this,args);
    // The discovery signature's canonical input is domain + 240-byte body;
    // local custody verification signs only its fresh 32-byte challenge.
    if(args[3]?.byteLength>240&&!changed){changed=true;await grant(false);}
    return result;
  };
  try{check(await denied(()=>accept())&&changed,'permission removal during verification refuses hint');}
  finally{crypto.subtle.verify=original;}
  await grant(true);
  check((await accept()).status==='verified-discovery-hint','fresh verification can follow deliberate regrant');
  const {loadSoftwareIssuer}=await import('../tg-pairing/software-persona.mjs');
  const issuer=await loadSoftwareIssuer({wasm,store:owner.store,expectedGroup:group});let evidence;
  try{evidence=await issuer.issueRevocation({subject:receiver.subject,sequence:999n,reason:0});}finally{issuer.close();}
  const groupId=Array.from(group,b=>b.toString(16).padStart(2,'0')).join('');
  const membership=await owner.store.read('membership',groupId),revoked=structuredClone(membership);
  revoked.value.revocations.push(evidence);
  check(await denied(()=>accept(packet,{store:{...owner.store,read:(scope,key)=>scope==='membership'&&key===groupId?Promise.resolve(revoked):owner.store.read(scope,key)}})),'authentic signed removal rejects old discovery hint');
  check((await owner.store.read('membership',groupId)).revision===membership.revision,'revocation overlay does not alter enrollment fixture');
  if(globalThis.relayNetwork){
    const {createRelayTransport}=await import('./transport.mjs');const {createLocalRelayHello}=await import('./local-hello.mjs');
    const transports=[],states=[[],[]];let delivered,problem;
    try{
      for(const [i,device] of [owner,receiver].entries()){
        transports[i]=createRelayTransport({url:location.origin.replace('https:','wss:')+'/r2',
          createHello:()=>createLocalRelayHello({wasm,store:device.store,expectedGroup:group}),onStatus:s=>states[i].push(s),
          onFrame:bytes=>{if(i===0)void accept(bytes).then(value=>{delivered=value;},error=>{problem=error;});}});
        transports[i].start();
      }
      const wait=async fn=>{for(let n=0;n<1000;n++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Discovery network timeout');};
      await wait(()=>states.every(s=>s.at(-1)==='connected'));transports[1].send(packet);
      await wait(()=>delivered||problem);if(problem)throw problem;
      check(delivered.peer.every((b,i)=>b===receiver.subject[i]),'WSS discovery delivers verified enrolled identity');
    }finally{transports.forEach(t=>t.disconnect());}
  }
  await grant(false);
}
