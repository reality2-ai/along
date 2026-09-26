// Guided recovery for an existing device identity. The owner authorizes sending
// to the selected member; the recipient separately reviews and accepts the update.
import {createRecoveryInvitation,readRecoveryInvitation,recoveryInvitationLink,recoveryInvitationFromLink} from './connection-invitation.mjs';
import {createRecoveryChannel} from './invitation-channel.mjs';
import {createAutomaticEpochRecovery} from './automatic-epoch-recovery.mjs';
import {showEpochRecoveryReview} from './epoch-recovery-view.mjs';
import {loadLocalPersona} from './local-persona.mjs';
import {renderTransferQr,scanTransferQr} from './qr-transfer.mjs';
import {hiveEndpoint} from '../r2-current/hive-transport.mjs';
const mounted=new WeakMap();
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
export function showAutomaticEpochRecovery(container,{wasm,store,expectedGroup,role,peer,relay='',connectionText,
  appURL=container.ownerDocument.defaultView.location.href.split('#')[0],focus=false,onBack=()=>{}}) {
  if(!['owner','recipient'].includes(role) || !(expectedGroup instanceof Uint8Array) || expectedGroup.length!==32
      || role==='owner' && (!(peer instanceof Uint8Array) || peer.length!==32))throw Error('Recovery context unavailable');
  mounted.get(container)?.();
  const doc=container.ownerDocument,group=expectedGroup.slice(),member=peer?.slice();
  const lifetime=new AbortController(),transportLifetime=new AbortController();
  let disposed=false,finished=false,failed=false,busy=false,channel,flow,review,session,resolve,reject;
  const completed=new Promise((yes,no)=>{resolve=yes;reject=no;});void completed.catch(()=>{});
  const node=(tag,text='')=>{const n=doc.createElement(tag);n.textContent=text;return n;};
  const current=()=>{if(disposed||failed||finished||lifetime.signal.aborted)throw Error('Recovery ended');};
  const stop=()=>{
    if(lifetime.signal.aborted)return;
    flow?.close();lifetime.abort();
    if(flow)setTimeout(()=>transportLifetime.abort(),2000);
    else{transportLifetime.abort();channel?.close();}
  };
  const dispose=()=>{
    if(disposed)return;disposed=true;stop();review?.dispose();reject(Error('Recovery closed'));
    if(mounted.get(container)===dispose)mounted.delete(container);
  };
  mounted.set(container,dispose);
  const leave=()=>{dispose();onBack();};
  const screen=(title,text)=>{
    const panel=node('section');panel.className='pairing-comparison';
    const heading=node('h2',title);heading.tabIndex=-1;
    const status=node('p',text);status.setAttribute('role','status');status.setAttribute('aria-atomic','true');
    panel.append(heading,status);container.replaceChildren(panel);
    panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();leave();}});
    if(focus)heading.focus();return {panel,status};
  };
  const button=(panel,label,run,primary=false)=>{
    const b=node('button',label);b.type='button';if(primary)b.className='pairing-primary';
    b.addEventListener('click',e=>{if(e.isTrusted&&!disposed&&!b.disabled)void run();});panel.append(b);return b;
  };
  const waiting=(title,text)=>{const v=screen(title,text);button(v.panel,'Cancel',leave);return v;};
  const fail=()=>{
    if(disposed||finished||failed)return;
    // Once mounted, recipient review owns the durable local-installation result.
    if(review)return;
    failed=true;stop();
    const v=screen('Device update is not confirmed','The connection ended or the invitation expired. Keep both devices’ saved data. Go Back to create a new invitation and check the saved version. Some updates may already be saved. Downloaded journeys remain available.');
    button(v.panel,'Back',leave,true);reject(Error('Recovery unconfirmed'));
  };
  const connect=async invitation=>{
    channel=await createRecoveryChannel({invitation,role:role==='owner'?'provisioner':'candidate',
      signal:transportLifetime.signal,onError:()=>{session?.close();fail();}});current();
    flow=await createAutomaticEpochRecovery({wasm,store,invitation,role,channel,signal:lifetime.signal,onError:fail,
      onReady:async result=>{
        current();session=result.session;
        if(role==='recipient'){
          review=showEpochRecoveryReview(container,{session,focus,onBack:leave});
          void review.completed.then(value=>{if(!disposed){finished=true;resolve(value);}},error=>{if(!disposed)reject(error);});
        }else{
          waiting('Waiting for your other device','Its identity is verified. Review and accept the update on that device. The update will then be sent automatically.');
          try{
            await session.accepted();current();
            waiting('Updating your other device','Keep both screens open while its saved keys are checked and confirmed.');
            const saved=await session.recover();current();finished=true;
            const v=screen('Other device confirmed its keys',`Its signed confirmation for key version ${saved.epoch} is saved here. You can return to your journeys.`);
            button(v.panel,'Done',leave,true);resolve(saved);
          }catch{fail();}
        }
      }});
    current();channel.start();await flow.start();
  };
  const checkRecipient=async text=>{
    const invitation=readRecoveryInvitation(text),local=await loadLocalPersona({wasm,store,expectedGroup:group});current();
    const saved=await store.read('candidate-persona','active');current();
    if(local?.origin!=='enrolled' || invitation.group!==hex(group) || invitation.member!==local.member
        || invitation.owner!==hex(saved.value.invitation.issuer))throw Error('Different saved recovery identity');
    return invitation;
  };
  const showReview=async text=>{
    let invitation;
    try{invitation=await checkRecipient(text);}catch{
      if(disposed)return;
      const v=screen('This update invitation cannot be used','Use a fresh invitation for this device from the device that originally invited it. Your existing group and saved journeys have been kept.');
      button(v.panel,'Back',leave,true);return;
    }
    const v=screen('Reconnect for a device update?','Use this invitation only if it came from your other device. Along will verify both saved identities, then let you review the key update.');
    v.panel.append(node('p','Use this relay for the update:'),node('code',invitation.relay));
    const details=node('details');details.append(node('summary','Connection and privacy'),node('p','The relay sees network addresses, temporary identifiers and timing. Key updates are encrypted between your devices. This does not share journeys or an AT API key, or change your saved sharing choices.'));
    v.panel.append(details);
    const use=button(v.panel,'Connect and review update',async()=>{
      if(busy)return;busy=true;use.disabled=true;
      try{await checkRecipient(text);waiting('Connecting to your other device','Keep both screens open. Replies are sent automatically.');await connect(text);}catch{fail();}
    },true);button(v.panel,'Cancel',leave);
  };
  const ready=(async()=>{
    if(role==='owner'){
      const v=screen('Update your other device','Create one invitation for the selected device. When it accepts the update, Along sends the keys and checks its confirmation automatically.');
      const label=node('label','Relay server address'),input=node('input');input.type='url';input.value=relay;input.autocomplete='off';input.spellcheck=false;label.append(input);v.panel.append(label);
      const details=node('details');details.append(node('summary','Connection and privacy'),node('p','Use your chosen relay for this update. It sees network addresses and timing, but key updates are encrypted between devices. No journey or AT key is shared.'));
      v.panel.append(details);
      const create=button(v.panel,'Create update invitation',async()=>{
        if(busy)return;
        try{hiveEndpoint(input.value.trim());}catch{v.status.textContent='Enter a secure wss:// relay address without a password, query or fragment.';input.focus();return;}
        busy=true;create.disabled=true;
        try{
          const identity=await loadLocalPersona({wasm,store,expectedGroup:group});current();
          if(identity?.origin!=='initial'||identity.epoch===0n)throw Error('No key update available');
          const text=await createRecoveryInvitation({group:hex(group),owner:identity.member,member:hex(member),relay:input.value.trim()});current();
          const link=recoveryInvitationLink(appURL,text);
          const scan=waiting('Scan to update your other device','Open this invitation on the selected device. Keep both screens open. It expires after one minute; no return code is needed.');
          const qr=node('div');scan.panel.insertBefore(qr,scan.panel.lastChild);renderTransferQr(qr,link);
          const alternative=node('details');alternative.append(node('summary','Use an update link instead'));
          const copyLabel=node('label','Update invitation link'),copy=node('textarea');copy.readOnly=true;copy.rows=3;copy.value=link;copyLabel.append(copy);alternative.append(copyLabel);
          button(alternative,'Copy update link',async()=>{try{await doc.defaultView.navigator.clipboard.writeText(link);scan.status.textContent='Update link copied. Open it on your other device.';}catch{copy.focus();copy.select();scan.status.textContent='Select and copy the update link.';}});
          scan.panel.insertBefore(alternative,scan.panel.lastChild);await connect(text);
        }catch{fail();}
      },true);button(v.panel,'Cancel',leave);
    }else if(connectionText)await showReview(connectionText);
    else{
      const v=screen('Receive a device update','On the device that invited this one, choose Send a group key update and select this device. Scan its invitation or open its update link.');
      const label=node('label','Update invitation link'),input=node('textarea');input.rows=3;input.maxLength=12288;input.autocomplete='off';input.spellcheck=false;label.append(input);
      const area=node('div');
      const scan=button(v.panel,'Scan update invitation',async()=>{
        if(scan.disabled)return;scan.disabled=true;const before=input.value;
        try{await scanTransferQr(area,input,lifetime.signal);if(!disposed&&input.value!==before)await showReview(recoveryInvitationFromLink(input.value.trim()));}
        catch{if(!disposed)v.status.textContent='This code could not be read as a current update invitation. Paste a fresh update link below.';}
        finally{scan.disabled=false;}
      },true);v.panel.append(area,label);
      button(v.panel,'Review update invitation',async()=>{try{await showReview(recoveryInvitationFromLink(input.value.trim()));}catch{v.status.textContent='Use a fresh update link from your other device.';input.focus();}});
      button(v.panel,'Cancel',leave);
    }
  })();void ready.catch(fail);
  return Object.freeze({ready,completed,dispose});
}
