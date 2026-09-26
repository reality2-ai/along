import {loadSoftwareIssuer} from '../tg-pairing/software-persona.mjs';
import {encodeRemoval,receiveRemoval} from '../tg-pairing/removal-message.mjs';
import {receiveRemovalSet} from '../tg-pairing/removal-set.mjs';
import {removalNoticePackets,readRemovalNotice} from './removal-notices.mjs';
import {openRelaySharingService} from './sharing-service.mjs';
import {readRelayConfiguration,saveRelayConfiguration} from './configuration.mjs';
import {readJourneyPermission,setJourneyPermission} from '../journey-sync/permission.mjs';
import {openJourneyStore} from '../journey-sync/store.mjs';

export async function checkRemovalDeliveryEdges({wasm,owner,receiver,group}) {
  const hex=b=>Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');
  const check=(value,why)=>{if(!value)throw Error(why);};
  const denied=fn=>fn().then(()=>false,()=>true);
  const devices=[owner,receiver],services=[],states=[[],[]];
  const options=devices.map(d=>({wasm,store:d.store,expectedGroup:group,member:hex(d.subject)}));
  const wait=async fn=>{for(let n=0;n<3000;n++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Removal delivery timeout '+JSON.stringify(states));};
  const issue=async subject=>{
    const issuer=await loadSoftwareIssuer(options[0]);
    try{return await issuer.issueRevocation({subject,sequence:1n,reason:0});}finally{issuer.close();}
  };
  const packetFor=evidence=>{
    // Existing removal-set fixture format; the real verifier must accept its signature.
    const raw=new Uint8Array(113),view=new DataView(raw.buffer);
    raw.set(evidence.subject);view.setBigUint64(32,evidence.epoch);view.setBigUint64(40,evidence.sequence);
    raw[48]=evidence.reason;raw.set(evidence.signature,49);
    return removalNoticePackets({expectedGroup:group,text:btoa(String.fromCharCode(...raw))})[0];
  };
  const membership=()=>receiver.store.read('membership',hex(group));
  const evidence=await issue(new Uint8Array(32).fill(97)),packet=packetFor(evidence);
  const text=readRemovalNotice({expectedGroup:group,packet}),before=await membership();
  const invalid=packet.slice();invalid[40]^=1;
  check(await denied(()=>receiveRemovalSet({...options[1],text:readRemovalNotice({expectedGroup:group,packet:invalid})})),'tampered signed subject refused by actual membership verifier');
  let wrongGroup=false;try{readRemovalNotice({expectedGroup:new Uint8Array(32),packet});}catch{wrongGroup=true;}
  check(wrongGroup,'wrong established group refused');
  check(await denied(()=>receiveRemovalSet({...options[1],text,store:{...receiver.store,compareAndSwapMany:async()=>{throw Error('Injected storage failure');}}})),'failed durable write refused');
  check((await membership()).revision===before.revision,'invalid and storage-failed notices preserve membership');

  let reached,release;
  const atCommit=new Promise(r=>{reached=r;}),gate=new Promise(r=>{release=r;}),abort=new AbortController();
  const pending=denied(()=>receiveRemovalSet({...options[1],text,signal:abort.signal,store:{...receiver.store,
    compareAndSwapMany:async(operations,opts)=>{reached();await gate;return receiver.store.compareAndSwapMany(operations,opts);}}}));
  await atCommit;abort.abort();release();check(await pending,'cancellation at the transaction boundary refuses save');
  check((await membership()).revision===before.revision,'cancelled notice preserves membership');

  const url=location.origin.replace('https:','wss:')+'/r2';
  for(let i=0;i<2;i++){
    const ctx={...options[i],peer:devices[1-i].subject,certificate:devices[1-i].certificate};
    await setJourneyPermission({...ctx,allow:true,expectedRevision:(await readJourneyPermission(ctx)).revision});
    await saveRelayConfiguration({...options[i],expectedRevision:(await readRelayConfiguration(options[i])).revision,url,enabled:true});
  }
  const open=i=>openRelaySharingService({...options[i],onStatus:s=>states[i].push(s.state)});
  const replica=openJourneyStore({store:receiver.store,group:hex(group),actor:hex(receiver.subject)});
  try{
    // The receiver is disconnected when the sender learns the new removal.
    services[0]=await open(0);
    await receiveRemoval({...options[0],text:encodeRemoval(group,evidence)});
    check((await membership()).revision===before.revision,'offline receiver has not learned sender update');
    services[1]=await open(1);
    await wait(()=>states[1].includes('removal-saved'));
    check((await membership()).value.revocations.some(r=>hex(r.subject)===hex(evidence.subject)),'returning receiver catches up over actual TLS relay');
    const received=await membership();
    check((await receiveRemovalSet({...options[1],text})).added===0,'repeated verified removal is idempotent');
    check((await membership()).revision===received.revision,'repeat does not churn membership revision');
    await wait(()=>states.every(s=>s.includes('peer-saved-snapshot')));

    const saved=JSON.stringify((await replica.read()).state);
    const selfRemoval=await issue(receiver.subject);
    await receiveRemoval({...options[0],text:encodeRemoval(group,selfRemoval)});
    await wait(()=>services[1].signal.aborted);
    check((await membership()).value.revocations.some(r=>hex(r.subject)===hex(receiver.subject)),'receiver verifies its own removal through relay');
    check(await denied(()=>services[1].synchronize()),'removed service cannot synchronize');
    check(await denied(()=>openRelaySharingService(options[1])),'removed identity cannot reopen sharing');
    check(JSON.stringify((await replica.read()).state)===saved,'self-removal preserves downloaded saved-place state');
    globalThis.removalEdgesPassed=true;
  }finally{services.forEach(s=>s?.close());}
}
