// Local review of previously retained, signed data. Receiving consent and peer
// authentication happen at transfer; this explicit local decision works offline.
import {verifyJourneyCheckpoint} from './generation-checkpoint.mjs';
import {installJourneyCheckpoint} from './checkpoint-installation.mjs';
const scope='along-journey-checkpoint-inbox-v1',replicas='along-saved-journeys-v2';
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const fail=()=>new Error('Received checkpoint changed or unavailable');
export async function readReceivedCheckpoint({store,expectedGroup}) {
  if(!(expectedGroup instanceof Uint8Array)||expectedGroup.length!==32)throw fail();
  const group=hex(expectedGroup),inbox=await store.read(scope,group);
  if(!inbox)return null;
  const replica=await store.read(replicas,group),value=inbox.value;
  if(!replica||value?.format!==1||Object.keys(value).sort().join(',')!=='checkpoint,format,previous,snapshot')throw fail();
  const next=await verifyJourneyCheckpoint({bytes:value.checkpoint,current:value.previous,snapshot:value.snapshot});
  const installed=replica.value.generation===next.generation&&replica.value.checkpoint===next.checkpoint;
  if(!installed)await verifyJourneyCheckpoint({bytes:value.checkpoint,current:replica.value,snapshot:value.snapshot});
  if((await store.read(scope,group))?.revision!==inbox.revision
      ||(await store.read(replicas,group))?.revision!==replica.revision)throw fail();
  return installed?null:{inboxRevision:inbox.revision,expectedRevision:replica.revision,
    generation:next.generation,checkpoint:value.checkpoint.slice(),snapshot:structuredClone(value.snapshot)};
}
export async function installReceivedCheckpoint({store,expectedGroup,inboxRevision,...options}) {
  if(!Number.isSafeInteger(inboxRevision)||inboxRevision<1)throw fail();
  const pending=await readReceivedCheckpoint({store,expectedGroup});
  if(!pending||pending.inboxRevision!==inboxRevision||pending.expectedRevision!==options.expectedRevision
      ||!(options.checkpoint instanceof Uint8Array)||hex(pending.checkpoint)!==hex(options.checkpoint)
      ||JSON.stringify(pending.snapshot)!==JSON.stringify(options.snapshot))throw fail();
  const guard={scope,key:hex(expectedGroup),expectedRevision:inboxRevision};
  const guarded={...store,compareAndSwapMany:(changes,settings)=>store.compareAndSwapMany(changes,
    {...settings,checks:[...(settings?.checks??[]),guard]})};
  return installJourneyCheckpoint({...options,store:guarded,expectedGroup});
}
