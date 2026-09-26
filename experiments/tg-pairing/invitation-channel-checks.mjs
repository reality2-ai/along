// Browser-only fault checks used by automatic-enrollment.test.mjs. No network,
// persisted identities or real credentials: transport factories relay test frames.
import {createConnectionInvitation, readConnectionInvitation, connectionInvitationLink, invitationFromLink, createRecoveryInvitation, readRecoveryInvitation, recoveryInvitationLink, recoveryInvitationFromLink} from './connection-invitation.mjs';
import {createInvitationChannel, createRecoveryChannel} from './invitation-channel.mjs';
const assert = (value,message) => { if (!value) throw Error(message); };
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const refused = fn => { try { fn(); return false; } catch { return true; } };
function wire({drop = false} = {}) {
  const endpoints = [], counts = [0,0], copies = [];
  return {counts,copies,factory: options => {
    const i = endpoints.length, entry = {options,connected:false}; endpoints.push(entry);
    return {start(){entry.connected=true;options.onStatus('connected');},stop(){entry.connected=false;},
      get connected(){return entry.connected;},
      send(frame){
        if (!entry.connected) return false;
        counts[i]++; copies.push(frame.slice());
        if (drop && counts[i] === 1) return true; // first fragment, then first ack
        queueMicrotask(() => {
          const other = endpoints[1-i];
          if (other?.connected) { other.options.onFrame(frame.slice()); other.options.onFrame(frame.slice()); }
        }); return true;
      }};
  }};
}
export async function checkInvitationChannel({descriptor,relay}) {
  const invitation = await createConnectionInvitation({descriptor,relay});
  const value = readConnectionInvitation(invitation);
  const link = connectionInvitationLink('https://example.test/along/',invitation);
  assert(invitationFromLink(link) === invitation,'Invitation fragment round trip');
  assert(!new URL(link).search && new URL(link).pathname === '/along/','No invitation in request path/query');
  for (const changed of [{expires:Date.now()-1},{expires:Date.now()+120000},{extra:true},
    {relay:'ws://example.test/r2'},{relay:'wss://name:password@example.test/r2'},
    {relay:'wss://example.test/r2?key=secret'},{secret:'short'},{candidate:value.provisioner},
    {descriptor:'{}'}]) assert(refused(() => readConnectionInvitation(JSON.stringify({...value,...changed}))),'Unsafe envelope accepted');
  const bus = wire({drop:true}), received = [], errors = [];
  const first = await createInvitationChannel({invitation,role:'candidate',transportFactory:bus.factory,onError:e=>errors.push(e.message)});
  const second = await createInvitationChannel({invitation,role:'provisioner',transportFactory:bus.factory,onError:e=>errors.push(e.message)});
  first.subscribe(() => {});second.subscribe(text=>received.push(text));first.start();second.start();
  try {
    const text = 'synthetic-signalling-contents-'.repeat(40);
    await first.send(text);
    assert(received.length === 1 && received[0] === text,'Lost-fragment/ack retry or duplicate delivery');
    assert(errors.length === 0 && bus.counts[1] >= 2,'Ack was not retried');
    assert(bus.copies.every(frame => !new TextDecoder().decode(frame).includes('synthetic-signalling-contents')),'Clear signalling exposed');
  } finally { first.close();second.close(); }
  for (const changed of [{secret:'01'.repeat(32)},{relay:'wss://other.example.test/r2'}]) {
    const isolated = wire(), deliveries = [];
    const a = await createInvitationChannel({invitation,role:'candidate',transportFactory:isolated.factory});
    const b = await createInvitationChannel({invitation:JSON.stringify({...value,...changed}),role:'provisioner',transportFactory:isolated.factory});
    a.subscribe(()=>{});b.subscribe(text=>deliveries.push(text));a.start();b.start();
    const sending = a.send('must-not-be-delivered').then(()=>false,()=>true);
    await sleep(80);a.close();b.close();
    assert(await sending,'Cancellation did not reject pending send');
    assert(deliveries.length === 0,'Wrong secret or altered context admitted');
  }
  const abort = new AbortController(), silent = wire();
  const pending = await createInvitationChannel({invitation,role:'candidate',signal:abort.signal,transportFactory:silent.factory});
  pending.subscribe(()=>{});pending.start();
  const cancelled = pending.send('no peer yet').then(()=>false,()=>true);abort.abort();
  assert(await cancelled,'Abort left send unresolved');
  assert(refused(()=>pending.send('after cancel')),'Closed channel accepted send');
  const recoveryText = await createRecoveryInvitation({group:'11'.repeat(32),owner:'22'.repeat(32),member:'33'.repeat(32),relay});
  const recovery = readRecoveryInvitation(recoveryText);
  assert(recoveryInvitationFromLink(recoveryInvitationLink('https://example.test/along/',recoveryText)) === recoveryText,'Recovery link round trip');
  assert(refused(()=>readConnectionInvitation(recoveryText)) && refused(()=>readRecoveryInvitation(invitation)),'Cross-purpose envelope accepted');
  for (const changed of [{profile:'along-connect-v1'},{member:recovery.owner},{owner:'invalid'},
    {group:'short'},{expires:Date.now()-1},{expires:Date.now()+120000},{extra:true},
    {relay:'wss://example.test/r2?secret=bad'}]) assert(refused(()=>readRecoveryInvitation(JSON.stringify({...recovery,...changed}))),'Unsafe recovery invitation accepted');
  const protectedBus = wire(), recovered=[];
  const owner = await createRecoveryChannel({invitation:recoveryText,role:'provisioner',transportFactory:protectedBus.factory});
  const recipient = await createRecoveryChannel({invitation:recoveryText,role:'candidate',transportFactory:protectedBus.factory});
  owner.subscribe(()=>{});recipient.subscribe(text=>recovered.push(text));owner.start();recipient.start();
  try {
    await owner.send('synthetic-recovery-secret');
    assert(recovered.length===1 && recovered[0]==='synthetic-recovery-secret','Recovery protected channel did not deliver');
    assert(protectedBus.copies.every(frame=>!new TextDecoder().decode(frame).includes('synthetic-recovery-secret')),'Recovery cleartext exposed');
  } finally {owner.close();recipient.close();}
  for (const changed of [{owner:'44'.repeat(32)},{member:'44'.repeat(32)},{group:'44'.repeat(32)},
    {relay:'wss://other.example.test/r2'},{secret:'55'.repeat(32)}]) {
    const isolated=wire(), deliveries=[];
    const a=await createRecoveryChannel({invitation:recoveryText,role:'provisioner',transportFactory:isolated.factory});
    const b=await createRecoveryChannel({invitation:JSON.stringify({...recovery,...changed}),role:'candidate',transportFactory:isolated.factory});
    a.subscribe(()=>{});b.subscribe(text=>deliveries.push(text));a.start();b.start();
    const pending=a.send('must-not-cross-context').then(()=>false,()=>true);
    await sleep(80);a.close();b.close();
    assert(await pending && deliveries.length===0,'Altered recovery identity/group/endpoint/secret admitted');
  }
  return 'fragment-only invitation; invalid envelopes refused; loss and duplicate recovery; encrypted carriage; secret/endpoint binding; cancellation; distinct recovery profile, protected delivery and identity/group/endpoint/secret binding';
}
