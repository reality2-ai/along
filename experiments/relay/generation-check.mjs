import {openRelayJourneyConnection} from './journey-connection.mjs';
import {readJourneyPermission,setJourneyPermission} from '../journey-sync/permission.mjs';
import {changeGenerationJourney} from '../journey-sync/generation-state.mjs';
import {projectJourney,journeyId} from '../journey-sync/state.mjs';
import {openGenerationAppJourneyStore} from '../journey-sync/generation-app-store.mjs';
import {readEnvelope} from '../journey-sync/app-preferences.mjs';
import {loadSoftwareIssuer} from '../tg-pairing/software-persona.mjs';
import {installJourneyCheckpoint} from '../journey-sync/checkpoint-installation.mjs';
export async function checkGenerationRelay({wasm,owner,receiver,group,roots,adapters}) {
  const hex=b=>Array.from(b,v=>v.toString(16).padStart(2,'0')).join(''),id=hex(group),devices=[owner,receiver];
  const check=(v,why)=>{if(!v)throw Error(why);};const denied=fn=>fn().then(()=>false,()=>true);
  const contexts=devices.map((device,i)=>({wasm,store:device.store,expectedGroup:group,peer:devices[1-i].subject,
    certificate:devices[1-i].certificate,generationAware:true,storage:roots[i],url:location.origin.replace('https:','wss:')+'/r2'}));
  const grant=async(i,allow)=>setJourneyPermission({...contexts[i],allow,expectedRevision:(await readJourneyPermission(contexts[i])).revision});
  await grant(0,true);await grant(1,true);
  const statuses=[[],[]],connections=[],scope='along-saved-journeys-v2';
  const read=i=>devices[i].store.read(scope,id);
  const wait=async fn=>{for(let n=0;n<2000;n++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Generation relay timeout: '+JSON.stringify(statuses));};
  const edit=async(n,name)=>{
    const before=await read(n),point=id=>({id,name:id,lat:-36,lon:174});
    const value=projectJourney({from:point('relay-generation-home'),to:point(name),savedRoutes:[{mode:'bus',route:'70'}]});
    const state=changeGenerationJourney(before.value,hex(devices[n].subject),journeyId(value),value);
    check((await devices[n].store.compareAndSwap(scope,id,before.revision,state)).applied,'fixture generation edit committed');
  };
  const same=async()=>JSON.stringify((await read(0)).value)===JSON.stringify((await read(1)).value);
  try{
    await edit(0,'relay-generation-work');
    const beforePlanner=readEnvelope(adapters[1]).raw;
    for(let i=0;i<2;i++)connections[i]=await openRelayJourneyConnection({...contexts[i],onStatus:s=>statuses[i].push(s)});
    await wait(()=>statuses.every(list=>list.includes('peer-saved-snapshot')));check(await same(),'generation relay replicas converge');
    check((await connections[0].synchronize()).status==='peer-saved-generation-snapshot','generation receipt uses correct codec');
    check(readEnvelope(adapters[1]).raw===beforePlanner,'network receipt does not rewrite planner');
    await openGenerationAppJourneyStore({store:receiver.store,group:id,actor:hex(receiver.subject),storage:adapters[1]}).reconcile();
    const local=readEnvelope(adapters[1]);check(local.data.journeys.some(j=>j.to.id==='relay-generation-work'&&j.saved),'explicit reconciliation shows shared place');
    check(local.data.journeys.some(j=>j.to.id==='sync-denied'&&j.count===7&&j.saved),'local history survives relay reconciliation');
    const counts=statuses.map(list=>list.filter(s=>s==='peer-saved-snapshot').length);
    await window.dropRelayPeer(hex(owner.subject));await wait(()=>statuses[0].includes('relay-waiting'));
    await edit(0,'relay-generation-offline');
    await wait(()=>statuses.every((list,i)=>list.filter(s=>s==='peer-saved-snapshot').length>counts[i]));check(await same(),'generation reconnect delivers offline edit');
    await openGenerationAppJourneyStore({store:owner.store,group:id,actor:hex(owner.subject),storage:adapters[0]}).reconcile();
    const issuer=await loadSoftwareIssuer({wasm,store:owner.store,expectedGroup:group});let prepared;
    try{prepared=await issuer.prepareJourneyCheckpoint({expectedRevision:(await read(0)).revision});}finally{issuer.close();}
    const recipientBefore=await read(1);
    await installJourneyCheckpoint({wasm,store:owner.store,expectedGroup:group,expectedRevision:(await read(0)).revision,
      expectedLocalRaw:readEnvelope(adapters[0]).raw,...prepared,storage:adapters[0]});
    check(await denied(()=>connections[0].synchronize()),'generation advance invalidates held relay snapshot access');
    check((await read(1)).revision===recipientBefore.revision,'generation change did not overwrite recipient');
    globalThis.generationRelayPassed=true;
  }finally{connections.forEach(c=>c.close());await grant(0,false);await grant(1,false);}
}
