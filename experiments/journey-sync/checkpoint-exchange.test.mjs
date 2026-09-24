import test from 'node:test';
import assert from 'node:assert/strict';
import {createCheckpointExchange} from './checkpoint-exchange.mjs';
import {createJourneyExchange} from './exchange.mjs';
import {selectNextCheckpoint,checkpointPosition} from './checkpoint-selection.mjs';
import {emptyState,changeJourney,journeyId,projectJourney} from './state.mjs';
import {journeySnapshotDigest,journeyCheckpointStatement,encodeJourneyCheckpoint,verifyJourneyCheckpoint} from './generation-checkpoint.mjs';
const keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
const groupBytes=new Uint8Array(await crypto.subtle.exportKey('raw',keys.publicKey));
const group=Array.from(groupBytes,b=>b.toString(16).padStart(2,'0')).join('');
let snapshot=emptyState(group);
for(let n=0;n<12;n++){
  const point=id=>({id,name:'Tāmaki Makaurau '+id,lat:-36,lon:174});
  const value=projectJourney({from:point('Home'),to:point('Work-'+n),savedRoutes:[{mode:'bus',route:'75'}]});
  snapshot=changeJourney(snapshot,group,journeyId(value),value);
}
const fields={group:groupBytes,from:0,to:1,parent:new Uint8Array(32),snapshotDigest:await journeySnapshotDigest(snapshot)};
const checkpoint=encodeJourneyCheckpoint(fields,new Uint8Array(await crypto.subtle.sign('Ed25519',keys.privateKey,journeyCheckpointStatement(fields))));
const payload={checkpoint,snapshot};
function pair({retain=async()=>({status:'checkpoint-retained-for-review'}),transform=(_,p)=>p,timeoutMs=1000}={}) {
  const ends=[],packets=[];
  for(let n=0;n<2;n++)ends[n]=createCheckpointExchange({group,timeoutMs,retain,
    send:async bytes=>{packets.push(bytes.slice());const packet=transform(n,bytes.slice());if(packet)queueMicrotask(()=>{void ends[1-n].receive(packet).catch(()=>{});});},
    onClose:()=>ends[1-n]?.close()});
  return {a:ends[0],b:ends[1],packets,close:()=>ends.forEach(e=>e.close())};
}
test('checkpoint chunks verify signature and confirm retention only after durable callback',async()=>{
  let release,entered,received;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  const link=pair({retain:async value=>{received=value;entered();await gate;return {status:'checkpoint-retained-for-review'};}});
  try{
    const sending=link.a.sendCheckpoint(payload);await started;
    assert.equal(link.packets.some(p=>p[0]===20),false);release();
    const receipt=await sending;assert.equal(receipt.status,'peer-retained-checkpoint');
    assert.deepEqual(received,payload);assert.ok(link.packets.filter(p=>p[0]===18).length>1);
    assert.ok(link.packets.every(p=>p.length<=2048));
  }finally{link.close();}
});
test('invalid signature, altered snapshot, false receipt and reordered chunks cannot confirm',async()=>{
  for(const mode of ['signature','snapshot','receipt','offset']){
    let retained=0;const input=structuredClone(payload);
    if(mode==='signature')input.checkpoint[183]^=1;
    if(mode==='snapshot')input.snapshot.journeys[0].value.to.name='Altered';
    const link=pair({retain:async()=>{retained++;return {status:'checkpoint-installed-locally'};},
      transform:(n,p)=>{if(mode==='offset'&&n===0&&p[0]===18)new DataView(p.buffer).setUint32(17,9);return p;}});
    try{await assert.rejects(link.a.sendCheckpoint(input));assert.equal(retained,mode==='receipt'?1:0);}finally{link.close();}
  }
});
test('lost retention receipt is unconfirmed; a fresh channel can retry',async()=>{
  const held=new Map();const retain=async value=>{held.set(Buffer.from(value.checkpoint).toString('hex'),value);return {status:'checkpoint-retained-for-review'};};
  const lost=pair({retain,timeoutMs:30,transform:(n,p)=>n===1&&p[0]===20?null:p});
  await assert.rejects(lost.a.sendCheckpoint(payload));lost.close();assert.equal(held.size,1);
  const retry=pair({retain});try{assert.equal((await retry.a.sendCheckpoint(payload)).status,'peer-retained-checkpoint');assert.equal(held.size,1);}finally{retry.close();}
});
test('ordinary journey frames cannot enter checkpoint transfer and local parent is separately checked',async()=>{
  const checkpointLink=pair();let ordinary;
  ordinary=createJourneyExchange({group,send:packet=>checkpointLink.b.receive(packet),commit:async()=>({status:'journeys-saved'})});
  try{await assert.rejects(ordinary.sendSnapshot(snapshot));assert.equal(checkpointLink.b.signal.aborted,true);}finally{ordinary.close();checkpointLink.close();}
  const wrongParent={format:2,group,generation:1,checkpoint:'a'.repeat(64),clock:0,journeys:[]};
  const link=pair({retain:async value=>{await verifyJourneyCheckpoint({bytes:value.checkpoint,snapshot:value.snapshot,current:wrongParent});return {status:'checkpoint-retained-for-review'};}});
  try{await assert.rejects(link.a.sendCheckpoint(payload));}finally{link.close();}
});
test('closing during retention never confirms or undoes retained data',async()=>{
  let release,entered,held;
  const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  const link=pair({retain:async value=>{held=structuredClone(value);entered();await gate;return {status:'checkpoint-retained-for-review'};}});
  const sending=link.a.sendCheckpoint(payload);
  const rejected=assert.rejects(sending);
  await started;link.b.close();release();await rejected;
  assert.deepEqual(held,payload);
  assert.equal(link.packets.some(p=>p[0]===20),false);
  link.close();
});
test('oversized checkpoint header refuses before retention',async()=>{
  let retained=false;
  const link=pair({retain:async()=>{retained=true;return {status:'checkpoint-retained-for-review'};},
    transform:(n,p)=>{if(n===0&&p[0]===17)new DataView(p.buffer).setUint32(17,2*1024*1024+1);return p;}});
  try{await assert.rejects(link.a.sendCheckpoint(payload));assert.equal(retained,false);}
  finally{link.close();}
});
test('checkpoint selection checks retained signature, parent and stable revisions without writing',async()=>{
  const peerState={generation:0,checkpoint:'0'.repeat(64)};
  const prepared={revision:1,value:{format:1,...payload}};
  const store={read:async scope=>scope==='along-prepared-journey-checkpoint-v1'?structuredClone(prepared):null};
  assert.deepEqual(await selectNextCheckpoint({store,group,peerState}),payload);
  assert.equal(await selectNextCheckpoint({store:{read:async()=>null},group,peerState}),null);
  const bad=structuredClone(prepared);bad.value.checkpoint[183]^=1;
  await assert.rejects(selectNextCheckpoint({store:{read:async()=>bad},group,peerState}));
  let reads=0;
  await assert.rejects(selectNextCheckpoint({store:{read:async scope=>{
    if(scope!=='along-prepared-journey-checkpoint-v1')return null;
    const record=structuredClone(prepared);record.revision=++reads;return record;
  }},group,peerState}));
  for(const invalid of [{generation:0,checkpoint:'a'.repeat(64)},
    {generation:Number.MAX_SAFE_INTEGER,checkpoint:'a'.repeat(64)},
    {...peerState,extra:true}])assert.throws(()=>checkpointPosition(invalid,group));
});
