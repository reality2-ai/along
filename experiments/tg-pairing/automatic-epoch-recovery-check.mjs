// Node-side check: only the initial recovery invitation crosses via the harness.
// Every removal, offer, answer, identity proof, epoch and receipt uses TLS relay.
import assert from 'node:assert/strict';
import {checkGuidedEpochRecovery} from './automatic-epoch-recovery-view-check.mjs';
export async function checkAutomaticEpochRecovery(pages, relayURL, {guided=false,stats}={}) {
  const [recipient,owner] = pages;
  const peer = await recipient.evaluate(async () => {
    window.wasm = await import('./hive_wasm.js'); await wasm.default();
    window.store = await (await import('./storage.mjs')).openBrowserStorage('software-enrollment');
    const saved = (await store.read('candidate-persona','active')).value;
    const hex = bytes => Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
    return {group:hex(saved.record.group),member:hex(saved.record.subject),epoch:String(saved.epoch)};
  });
  const firstInvitation = await owner.evaluate(async ({peer,relayURL}) => {
    window.flow?.close(); window.invite?.close(); window.issuer?.close();
    const {loadSoftwareIssuer} = await import('./software-persona.mjs');
    const {installPreparedIssuerEpoch} = await import('./epoch-installation.mjs');
    for (let i=0;i<2;i++) {
      const epoch = (await store.read('candidate-persona','active')).value.epoch + 1n;
      const issuer = await loadSoftwareIssuer({wasm,store,expectedGroup:group});
      try { await issuer.prepareRotation(); } finally { issuer.close(); }
      await installPreparedIssuerEpoch({wasm,store,expectedGroup:group,epoch});
    }
    const saved = (await store.read('candidate-persona','active')).value;
    const owner = Array.from(saved.record.subject,b=>b.toString(16).padStart(2,'0')).join('');
    return (await import('./connection-invitation.mjs')).createRecoveryInvitation({...peer,owner,relay:relayURL});
  },{peer,relayURL});
  if(guided){await checkGuidedEpochRecovery({pages,peer,relayURL,stats});return;}
  const makeInvitation = () => owner.evaluate(async ({peer,relayURL}) => {
    const saved=(await store.read('candidate-persona','active')).value;
    const owner=Array.from(saved.record.subject,b=>b.toString(16).padStart(2,'0')).join('');
    return (await import('./connection-invitation.mjs')).createRecoveryInvitation({...peer,owner,relay:relayURL});
  },{peer,relayURL});
  const close = () => Promise.all(pages.map(p=>p.evaluate(()=>{recoveryFlow?.close();recoveryChannel?.close();})));
  const connect = async (invitation, loseReceipt = false) => {
    for (const index of [1,0]) await pages[index].evaluate(async ({index,invitation,loseReceipt}) => {
    window.recoveryErrors=[];window.recoveryReady=false;window.recoveryKeysSent=0;
    window.originalRecoveryEncrypt ??= crypto.subtle.encrypt;
    crypto.subtle.encrypt = async function(algorithm,key,data) {
      let frame;try{frame=JSON.parse(new TextDecoder().decode(data));}catch{}
      if(frame?.type==='epoch')recoveryKeysSent++;
      if(loseReceipt && frame?.type==='installed' && frame.epoch===window.expectedRecoveryEpoch)
        throw Error('Injected lost installation confirmation');
      return originalRecoveryEncrypt.call(this,algorithm,key,data);
    };

    window.recoveryChannel=await(await import('./invitation-channel.mjs')).createRecoveryChannel({
      invitation,role:index?'provisioner':'candidate',onError:e=>recoveryErrors.push(e.message),
    });
    window.recoveryFlow=await(await import('./automatic-epoch-recovery.mjs')).createAutomaticEpochRecovery({
      wasm,store,invitation,role:index?'owner':'recipient',channel:recoveryChannel,
      onReady:({session,context})=>{window.recoverySession=session;window.recoveryContext=context;recoveryReady=true;},
      onError:e=>recoveryErrors.push(e.message),
    });
    recoveryChannel.start();
    },{index,invitation,loseReceipt});
    await recipient.evaluate(()=>recoveryFlow.start());
    await Promise.all(pages.map(p=>p.waitForFunction(()=>recoveryReady||recoveryErrors.length,{},{timeout:60000})));
    for (const p of pages) {
      assert.deepEqual(await p.evaluate(()=>recoveryErrors),[]);
      assert.deepEqual(await p.evaluate(()=>[String(recoveryContext.from),String(recoveryContext.to)]),
        [await recipient.evaluate(async()=>String((await store.read('candidate-persona','active')).value.epoch)),String(BigInt(peer.epoch)+2n)]);
    }
  };
  try {
    await connect(firstInvitation);
    await close();
    assert.equal(await recipient.evaluate(async()=>String((await store.read('candidate-persona','active')).value.epoch)),peer.epoch,
      'Cancellation before review preserves old keys');
    await recipient.evaluate(epoch=>window.expectedRecoveryEpoch=epoch,String(BigInt(peer.epoch)+2n));
    await connect(await makeInvitation(),true);
    assert.equal(await owner.evaluate(()=>recoverySession.recover().then(()=>true,()=>false)),false,'Explicit recipient review still required');
    assert.equal(await recipient.evaluate(async()=>String((await store.read('candidate-persona','active')).value.epoch)),peer.epoch);
    await recipient.evaluate(()=>recoverySession.acceptRecovery());
    await owner.waitForFunction(()=>recoverySession.canRecover());
    assert.equal(await owner.evaluate(()=>recoverySession.recover().then(()=>true,()=>false)),false,
      'Lost final receipt must not report remote confirmation');
    assert.equal(await recipient.evaluate(async()=>String((await recoverySession.installation()).epoch)),String(BigInt(peer.epoch)+2n),
      'Local installation remains true after final confirmation loss');
    assert.equal(await recipient.evaluate(async peer=>{
      const saved=(await store.read('candidate-persona','active')).value;
      const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
      return saved.epoch===BigInt(peer.epoch)+2n && hex(saved.record.subject)===peer.member && hex(saved.record.group)===peer.group;
    },peer),true,'Two ordered key updates preserve the existing identity and group');
    await close();
    // A new invitation uses the recipient's current certificate automatically.
    // It checks the saved receipt without resending or rewriting installed keys.
    const before=await recipient.evaluate(async peer=>(await store.read('candidate-persona','active')).revision,peer);
    await connect(await makeInvitation());
    await recipient.evaluate(()=>recoverySession.acceptRecovery());
    await owner.waitForFunction(()=>recoverySession.canRecover());
    assert.deepEqual(await owner.evaluate(async()=>{const result=await recoverySession.recover();return {...result,epoch:String(result.epoch)};}),
      {status:'peer-installation-confirmed',epoch:String(BigInt(peer.epoch)+2n)});
    assert.equal(await owner.evaluate(()=>recoveryKeysSent),0,'Receipt retry sends no group keys');
    assert.equal(await recipient.evaluate(async()=>(await store.read('candidate-persona','active')).revision),before,'Receipt retry leaves installation unchanged');
    console.log('PASS: automatic recovery through local TLS relay with WebRTC disabled; two stale epochs, mutual identity, explicit acceptance, cancellation, lost confirmation and receipt-only retry; harness transfers only the initial invitation. UI/physical acceptance not tested.');
  } finally {
    await close();
  }
}
