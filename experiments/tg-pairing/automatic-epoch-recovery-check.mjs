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
  const connect = async (invitation, loseReceipt = false, {badCertificate=false,refused=false}={}) => {
    for (const index of [1,0]) await pages[index].evaluate(async ({index,invitation,loseReceipt,badCertificate}) => {
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
      wasm,store,invitation,role:index?'owner':'recipient',channel:{...recoveryChannel,send:text=>{
        if(badCertificate && index===0){
          const message=JSON.parse(text);
          if(message.profile==='along-epoch-recovery-signalling-v1' && message.kind==='hello'){
            const certificate=message.body.certificate;
            message.body.certificate=certificate.slice(0,-2)+(parseInt(certificate.slice(-2),16)^1).toString(16).padStart(2,'0');
            text=JSON.stringify(message);
          }
        }
        return recoveryChannel.send(text);
      }},
      onReady:({session,context})=>{window.recoverySession=session;window.recoveryContext=context;recoveryReady=true;},
      onError:e=>recoveryErrors.push(e.message),
    });
    recoveryChannel.start();
    },{index,invitation,loseReceipt,badCertificate});
    await recipient.evaluate(()=>recoveryFlow.start());
    if(refused){
      await owner.waitForFunction(()=>recoveryErrors.length>0,{},{timeout:60000});
      assert.equal(await owner.evaluate(()=>recoveryReady),false,'Unauthorized peer did not authenticate');
      assert.equal(await owner.evaluate(()=>recoveryKeysSent),0,'Unauthorized peer received no replacement keys');
      return;
    }
    await Promise.all(pages.map(p=>p.waitForFunction(()=>recoveryReady||recoveryErrors.length,{},{timeout:process.env.RECOVERY_REMOVALS==='1'?310000:60000})));
    for (const p of pages) {
      assert.deepEqual(await p.evaluate(()=>recoveryErrors),[]);
      assert.deepEqual(await p.evaluate(()=>[String(recoveryContext.from),String(recoveryContext.to)]),
        [await recipient.evaluate(async()=>String((await store.read('candidate-persona','active')).value.epoch)),String(BigInt(peer.epoch)+2n)]);
    }
  };
  try {
    if(process.env.RECOVERY_REMOVALS==='1'){
      await owner.evaluate(async()=>{
        const issuer=await(await import('./software-persona.mjs')).loadSoftwareIssuer({wasm,store,expectedGroup:group});
        const groupId=Array.from(group,b=>b.toString(16).padStart(2,'0')).join('');
        try{
          const removals=[];
          for(let i=1;i<=256;i++)removals.push(await issuer.issueRevocation({subject:crypto.getRandomValues(new Uint8Array(32)),sequence:BigInt(i),reason:0}));
          const held=await store.read('membership',groupId),value=structuredClone(held.value);value.revocations.push(...removals);
          if(!(await store.compareAndSwapMany([{scope:'membership',key:groupId,expectedRevision:held.revision,value}])).applied)throw Error('Fixture removal setup raced');
        }finally{issuer.close();}
      });
      await connect(await makeInvitation());
      assert.equal(await recipient.evaluate(async peer=>(await store.read('membership',peer.group)).value.revocations.length,peer),256,
        'Recipient learns full signed snapshot through relay');
      await recipient.evaluate(()=>recoverySession.acceptRecovery());
      await owner.waitForFunction(()=>recoverySession.canRecover());
      assert.equal(await owner.evaluate(async()=>String((await recoverySession.recover()).epoch)),String(BigInt(peer.epoch)+2n));
      console.log('PASS: automatic recovery carries 256 issuer-signed removals from owner-only fixture state, verifies them on recipient and completes ordered key updates through local TLS relay.');
      return;
    }
    await connect(firstInvitation);
    await close();
    assert.equal(await recipient.evaluate(async()=>String((await store.read('candidate-persona','active')).value.epoch)),peer.epoch,
      'Cancellation before review preserves old keys');
    const beforeRefusal=await recipient.evaluate(async()=>(await store.read('candidate-persona','active')).revision);
    await connect(await makeInvitation(),false,{badCertificate:true,refused:true});await close();
    assert.equal(await recipient.evaluate(async()=>(await store.read('candidate-persona','active')).revision),beforeRefusal,
      'Forged certificate refusal preserves installed identity');
    await connect(await makeInvitation());
    await recipient.evaluate(epoch=>{
      const original=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(...args){
        const result=original.apply(this,args);
        if(args[1]?.[0]==='candidate-persona' && args[0]?.value?.epoch===BigInt(epoch)){
          IDBObjectStore.prototype.put=original;this.transaction.abort();
        }
        return result;
      };
    },String(BigInt(peer.epoch)+2n));
    await recipient.evaluate(()=>recoverySession.acceptRecovery());
    await owner.waitForFunction(()=>recoverySession.canRecover());
    assert.equal(await owner.evaluate(()=>recoverySession.recover().then(()=>true,()=>false)),false,
      'Aborted second installation cannot be reported complete');
    const partial=String(BigInt(peer.epoch)+1n);
    assert.equal(await recipient.evaluate(async()=>String((await store.read('candidate-persona','active')).value.epoch)),partial,
      'First committed epoch survives failed successor transaction');
    assert.equal(await recipient.evaluate(async peer=>{
      const traffic=await store.read('along-browser-traffic',peer.group);
      const membership=await store.read('membership',peer.group);
      return traffic.value.epoch===BigInt(peer.epoch)+1n && membership.value.current===traffic.value.epoch
        && await store.read('along-installed-epoch-v1',peer.group+':'+(BigInt(peer.epoch)+2n))===null;
    },peer),true,'Persona, traffic, membership and receipts agree on partial commit');
    await close();
    await recipient.evaluate(epoch=>window.expectedRecoveryEpoch=epoch,String(BigInt(peer.epoch)+2n));
    await connect(await makeInvitation(),true);
    assert.equal(await owner.evaluate(()=>recoverySession.recover().then(()=>true,()=>false)),false,'Explicit recipient review still required');
    assert.equal(await recipient.evaluate(async()=>String((await store.read('candidate-persona','active')).value.epoch)),partial);
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
    await close();
    const held=await recipient.evaluate(async()=>({revision:(await store.read('candidate-persona','active')).revision,
      certificate:Array.from((await store.read('candidate-persona','active')).value.record.certificate)}));
    const removedInvitation=await makeInvitation();
    await owner.evaluate(async({peer,certificate})=>{
      await(await import('./member-removal.mjs')).removeSoftwareMember({wasm,store,expectedGroup:group,
        subject:Uint8Array.from(peer.member.match(/../g),b=>parseInt(b,16)),certificate:new Uint8Array(certificate)});
    },{peer,certificate:held.certificate});
    await connect(removedInvitation,false,{refused:true});
    assert.equal(await recipient.evaluate(async()=>(await store.read('candidate-persona','active')).revision),held.revision,
      'Removed member cannot change installation through recovery');
    console.log('PASS: automatic recovery through local TLS relay with WebRTC disabled; two stale epochs, mutual identity, explicit acceptance, forged-certificate refusal, cancellation, aborted intermediate install with retained predecessor, lost confirmation, receipt-only retry and removed-member refusal; harness transfers only the initial invitation. UI/physical acceptance not tested.');
  } finally {
    await close();
  }
}
