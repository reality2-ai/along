import {openRelaySharingService} from './sharing-service.mjs';
import {readRelayConfiguration,saveRelayConfiguration} from './configuration.mjs';
import {readJourneyPermission,setJourneyPermission} from '../journey-sync/permission.mjs';
import {openJourneyStore} from '../journey-sync/store.mjs';
import {projectJourney} from '../journey-sync/state.mjs';
export async function checkRelayService({wasm,owner,receiver,group}) {
  const hex=b=>Array.from(b,v=>v.toString(16).padStart(2,'0')).join(''),check=(v,why)=>{if(!v)throw Error(why);};
  const devices=[owner,receiver],services=[],states=[[],[]];
  const options=devices.map(d=>({wasm,store:d.store,expectedGroup:group,member:hex(d.subject)}));
  check(await openRelaySharingService({...options[0],transportFactory:()=>{throw Error('Default contacted relay');}})===null,'disabled default makes no connection');
  const replicas=devices.map(d=>openJourneyStore({store:d.store,group:hex(group),actor:hex(d.subject)}));
  const url=location.origin.replace('https:','wss:')+'/r2';
  for(let i=0;i<2;i++){
    const context={...options[i],peer:devices[1-i].subject,certificate:devices[1-i].certificate};
    await setJourneyPermission({...context,allow:true,expectedRevision:(await readJourneyPermission(context)).revision});
    await saveRelayConfiguration({...options[i],expectedRevision:(await readRelayConfiguration(options[i])).revision,url,enabled:true});
  }
  const point=id=>({id,name:id,lat:-36,lon:174});
  await replicas[0].save(projectJourney({from:point('relay-service-home'),to:point('relay-service-work')}));
  const wait=async fn=>{for(let n=0;n<3000;n++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Relay service timeout '+JSON.stringify(states));};
  try{
    for(let i=0;i<2;i++)services[i]=await openRelaySharingService({...options[i],onStatus:s=>states[i].push(s.state)});
    await wait(()=>states.every(list=>list.includes('peer-saved-snapshot')));
    check(JSON.stringify((await replicas[0].read()).state)===JSON.stringify((await replicas[1].read()).state),'discovered permitted peers converge without supplied certificate');
    const counts=states.map(s=>s.filter(v=>v==='peer-saved-snapshot').length);
    await window.dropRelayPeer(hex(owner.subject));await wait(()=>states[0].includes('relay-waiting'));
    await replicas[0].save(projectJourney({from:point('relay-service-home'),to:point('relay-service-offline')}));
    await wait(()=>states.every((s,i)=>s.filter(v=>v==='peer-saved-snapshot').length>counts[i]));
    check(JSON.stringify((await replicas[0].read()).state)===JSON.stringify((await replicas[1].read()).state),'one-socket service reconnect converges');
    // Even a permission revision retaining this peer invalidates old audited
    // handshakes. Discovery must replace them rather than leave a dead entry.
    const priorReceipts=states.map(s=>s.filter(v=>v==='peer-saved-snapshot').length);
    await setJourneyPermission({...options[0],peer:receiver.subject,certificate:receiver.certificate,allow:true,
      expectedRevision:(await readJourneyPermission(options[0])).revision});
    await wait(()=>states[0].includes('permission-changed'));
    await wait(()=>states.every((s,i)=>s.filter(v=>v==='peer-saved-snapshot').length>priorReceipts[i]));
    await replicas[0].save(projectJourney({from:point('relay-service-home'),to:point('relay-service-renewed')}));
    const renewed=await services[0].synchronize();
    check(renewed.length===1&&renewed[0].status==='fulfilled','permission revision restores exactly one peer');
    check(JSON.stringify((await replicas[0].read()).state)===JSON.stringify((await replicas[1].read()).state),'renewed permission shares new snapshot');
    const before=(await replicas[1].read()).revision;
    await saveRelayConfiguration({...options[0],expectedRevision:(await readRelayConfiguration(options[0])).revision,url,enabled:false});
    await wait(()=>services[0].signal.aborted);check(states[0].at(-1)==='stopped','saved disable stops service');
    await replicas[0].save(projectJourney({from:point('relay-service-home'),to:point('relay-service-local-only')}));
    check(await services[0].synchronize().then(()=>false,()=>true),'disabled service refuses synchronize');
    check((await replicas[1].read()).revision===before,'disable preserves recipient replica');
    globalThis.relayServicePassed=true;
  }finally{
    services.forEach(s=>s?.close());
    for(let i=0;i<2;i++){
      await saveRelayConfiguration({...options[i],expectedRevision:(await readRelayConfiguration(options[i])).revision,url,enabled:false});
      await setJourneyPermission({...options[i],peer:devices[1-i].subject,allow:false,expectedRevision:(await readJourneyPermission(options[i])).revision});
    }
  }
}
