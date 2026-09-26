// Node browser harness. Link transfer represents opening the invitation; all
// later exchange is the real protected relay path. No human coding is needed.
import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import {expect} from '@playwright/test';
export async function checkGuidedEpochRecovery({pages,peer,relayURL,stats}) {
  const [recipient,owner]=pages;
  const epoch=String(BigInt(peer.epoch)+2n);
  const mountOwner=async()=>{
    await owner.evaluate(async({peer,relayURL})=>{
      window.guidedRecovery?.dispose();window.guidedBack=0;
      const unhex=text=>Uint8Array.from(text.match(/../g),b=>parseInt(b,16));
      window.guidedRecovery=(await import('./automatic-epoch-recovery-view.mjs')).showAutomaticEpochRecovery(document.querySelector('#flow'),{
        wasm,store,expectedGroup:unhex(peer.group),peer:unhex(peer.member),role:'owner',relay:relayURL,focus:true,onBack:()=>guidedBack++,
      });await guidedRecovery.ready;
    },{peer,relayURL});
    const before=stats().connections;
    await owner.getByRole('button',{name:'Create update invitation',exact:true}).click();
    await owner.getByRole('heading',{name:'Scan to update your other device',exact:true}).waitFor();
    await expect.poll(()=>stats().connections).toBe(before+1);
    return owner.getByLabel('Update invitation link',{exact:true}).inputValue();
  };
  const mountRecipient=async(link,loseReceipt=false,scan=false)=>{
    await recipient.evaluate(async({link,loseReceipt,epoch,scan})=>{
      window.guidedRecovery?.dispose();window.guidedBack=0;
      window.originalGuidedEncrypt??=crypto.subtle.encrypt;
      crypto.subtle.encrypt=async function(algorithm,key,data){
        let frame;try{frame=JSON.parse(new TextDecoder().decode(data));}catch{}
        if(loseReceipt&&frame?.type==='installed'&&frame.epoch===epoch)throw Error('Injected final confirmation loss');
        return originalGuidedEncrypt.call(this,algorithm,key,data);
      };
      const local=(await store.read('candidate-persona','active')).value;
      let incoming={};
      if(!scan){
        history.replaceState({},'',link);
        incoming=(await import('./automatic-pairing-view.mjs')).consumeConnectionFragment(location,history);
        if(!incoming?.recovery || location.hash)throw Error('Recovery fragment not consumed');
      }else{
        window.cameraRequested=0;window.cameraStopped=0;
        HTMLMediaElement.prototype.play=async()=>{};
        window.BarcodeDetector=class{static async getSupportedFormats(){return ['qr_code'];}async detect(){return [{format:'qr_code',rawValue:link}];}};
        Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{
          cameraRequested++;const stream=new MediaStream();Object.defineProperty(stream,'getTracks',{value:()=>[{stop:()=>cameraStopped++}]});return stream;
        }});
      }
      window.guidedRecovery=(await import('./automatic-epoch-recovery-view.mjs')).showAutomaticEpochRecovery(document.querySelector('#flow'),{
        wasm,store,expectedGroup:local.record.group,role:'recipient',connectionText:incoming.invitation,focus:true,onBack:()=>guidedBack++,
      });await guidedRecovery.ready;
    },{link,loseReceipt,epoch,scan});
    if(scan){
      assert.equal(await recipient.evaluate(()=>cameraRequested),0);
      await recipient.getByRole('button',{name:'Scan update invitation',exact:true}).click();
      await recipient.getByRole('heading',{name:'Reconnect for a device update?',exact:true}).waitFor();
      assert.equal(await recipient.evaluate(()=>cameraStopped),1,'Scan review releases the camera');
    }
  };
  const connect=async (loseReceipt,scan=false)=>{
    const link=await mountOwner(),before=stats().connections;
    await mountRecipient(link,loseReceipt,scan);
    await recipient.getByRole('heading',{name:'Reconnect for a device update?',exact:true}).waitFor();
    assert.equal(stats().connections,before,'Viewing incoming invitation opens no relay connection');
    await recipient.evaluate(()=>document.querySelector('.pairing-primary').click());
    assert.equal(stats().connections,before,'Synthetic click cannot consent to relay');
    await recipient.getByRole('button',{name:'Connect and review update',exact:true}).click();
  };
  try {
    const wrongLink=await mountOwner(),beforeRefusal=stats().connections;
    const changed=new URL(wrongLink),value=JSON.parse(decodeURIComponent(changed.hash.slice(9)));
    value.member='ab'.repeat(32);changed.hash='recover='+encodeURIComponent(JSON.stringify(value));
    const heldRevision=await recipient.evaluate(async()=>(await store.read('candidate-persona','active')).revision);
    await mountRecipient(changed.href);
    await recipient.getByRole('heading',{name:'This update invitation cannot be used',exact:true}).waitFor();
    assert.equal(stats().connections,beforeRefusal,'Different member invitation is refused before network');
    assert.equal(await recipient.evaluate(async()=>(await store.read('candidate-persona','active')).revision),heldRevision);
    await recipient.getByRole('button',{name:'Back',exact:true}).click();
    const expiring=await mountOwner(),beforeExpiry=stats().connections;
    await mountRecipient(expiring);
    await recipient.evaluate(()=>{window.recoveryRealClock=Date.now;const now=Date.now();Date.now=()=>now+61000;});
    try{
      await recipient.getByRole('button',{name:'Connect and review update',exact:true}).click();
      await recipient.getByRole('heading',{name:'Device update is not confirmed',exact:true}).waitFor();
      assert.equal(stats().connections,beforeExpiry,'Expired review opens no recipient connection');
      assert.equal(await recipient.evaluate(async()=>(await store.read('candidate-persona','active')).revision),heldRevision);
    }finally{await recipient.evaluate(()=>Date.now=window.recoveryRealClock);}
    await connect(false,true);
    await recipient.getByRole('heading',{name:'Receive your group key update?',exact:true}).waitFor();
    await recipient.getByRole('button',{name:'Back',exact:true}).click();
    assert.equal(await recipient.evaluate(()=>guidedBack),1);
    await owner.getByRole('heading',{name:'Device update is not confirmed',exact:true}).waitFor();
    assert.equal(await recipient.evaluate(async()=>String((await store.read('candidate-persona','active')).value.epoch)),peer.epoch);
    await connect(true);
    await recipient.getByRole('heading',{name:'Receive your group key update?',exact:true}).waitFor();
    await recipient.setViewportSize({width:320,height:720});
    await recipient.evaluate(()=>document.documentElement.style.fontSize='200%');
    assert.equal(await recipient.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual((await new AxeBuilder({page:recipient}).analyze()).violations.map(v=>v.id),[]);
    await recipient.evaluate(()=>document.documentElement.style.fontSize='');
    await recipient.evaluate(()=>document.querySelector('.pairing-primary').click());
    assert.equal(await recipient.evaluate(async()=>String((await store.read('candidate-persona','active')).value.epoch)),peer.epoch,
      'Synthetic update acceptance cannot save keys');
    await recipient.getByRole('button',{name:'Receive group key update',exact:true}).focus();
    await recipient.keyboard.press('Enter');
    await recipient.getByRole('heading',{name:'Group keys saved on this device',exact:true}).waitFor();
    await owner.getByRole('heading',{name:'Device update is not confirmed',exact:true}).waitFor();
    assert.equal(await recipient.evaluate(async()=>String((await guidedRecovery.completed).epoch)),epoch);
    assert.equal(await recipient.evaluate(()=>document.activeElement.textContent),'Back');
    const revision=await recipient.evaluate(async()=>(await store.read('candidate-persona','active')).revision);
    await connect(false);
    await recipient.getByRole('heading',{name:'Confirm your saved group keys?',exact:true}).waitFor();
    await recipient.getByRole('button',{name:'Check saved keys and send confirmation',exact:true}).click();
    await owner.getByRole('heading',{name:'Other device confirmed its keys',exact:true}).waitFor();
    await recipient.getByRole('heading',{name:'Group keys saved on this device',exact:true}).waitFor();
    assert.equal(await recipient.evaluate(async()=>(await store.read('candidate-persona','active')).revision),revision);
    await owner.getByRole('button',{name:'Done',exact:true}).click();assert.equal(await owner.evaluate(()=>guidedBack),1);
    console.log('PASS: guided recovery link clears fragment, wrong-member and expired-review refusal, scanner result and camera release (camera/decoder stub), no recipient network before trusted consent, Back preserves old keys, keyboard acceptance, 320px/200% and axe, lost confirmation retains local success, new invitation confirms without rewriting installation. Local TLS relay; WebRTC disabled.');
  }finally{
    await Promise.all(pages.map(p=>p.evaluate(()=>guidedRecovery?.dispose())));
  }
}
