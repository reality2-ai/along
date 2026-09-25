// Guided enrollment. It consumes the existing proof/core and never grants AT or
// journey access implicitly. The app supplies the subsequent sharing review.
import {initializeLocalPersona} from './initial-persona.mjs';
import {createSoftwareInvitation} from './software-invitation.mjs';
import {createConnectionInvitation,readConnectionInvitation,connectionInvitationLink,invitationFromLink} from './connection-invitation.mjs';
import {createInvitationChannel} from './invitation-channel.mjs';
import {createAutomaticEnrollment} from './automatic-enrollment.mjs';
import {renderTransferQr,scanTransferQr} from './qr-transfer.mjs';
import {hiveEndpoint} from '../r2-current/hive-transport.mjs';
import {showComparison} from './comparison.mjs';
const mounted = new WeakMap();
// Call as early as app startup, before asynchronous work or optional telemetry.
// Parsing never opens a network connection; the view obtains explicit consent.
export function consumeConnectionFragment(location, history) {
  if (!location.hash.startsWith('#connect=')) return undefined;
  const href = location.href;
  history.replaceState(history.state,'',location.pathname + location.search);
  try { return {invitation:invitationFromLink(href)}; }
  catch { return {invalid:true}; }
}
export function showAutomaticPairing(container,{wasm,store,role,expectedGroup,relay='',connectionText,
  appURL=container.ownerDocument.defaultView.location.href.split('#')[0],focus=false,onBack=()=>{},onConnected=()=>{},onShare}) {
  if (!['candidate','provisioner'].includes(role)) throw Error('Connection role required');
  mounted.get(container)?.();
  const doc=container.ownerDocument,lifetime=new AbortController(),transportLifetime=new AbortController();
  let disposed=false,finished=false,failed=false,busy=false,invitation,channel,flow,session,payloads,comparison;
  let installation,acknowledgment,peer,connection;
  let phase='invitation',relayState='disconnected';
  const node=(tag,text='')=>{const n=doc.createElement(tag);n.textContent=text;return n;};
  const stop=()=>{
    if(lifetime.signal.aborted)return;
    // Stop membership work immediately, but allow the carriage's bounded close
    // notification to reach the other screen before releasing its socket.
    flow?.close();lifetime.abort();comparison?.dispose();invitation?.close();
    if(flow)setTimeout(()=>transportLifetime.abort(),2000);
    else{transportLifetime.abort();channel?.close();}
  };
  const dispose=()=>{if(disposed)return;disposed=true;stop();if(mounted.get(container)===dispose)mounted.delete(container);};
  mounted.set(container,dispose);
  const leave=()=>{dispose();onBack();};
  const current=()=>{if(disposed||failed||finished||lifetime.signal.aborted)throw Error('Connection ended');};
  const screen=(title,text)=>{
    comparison?.dispose();comparison=undefined;
    const panel=node('section');panel.className='pairing-comparison';
    const heading=node('h2',title);heading.tabIndex=-1;
    const status=node('p',text);status.setAttribute('role','status');status.setAttribute('aria-atomic','true');
    panel.append(heading,status);container.replaceChildren(panel);
    panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();leave();}});
    if(focus)heading.focus();return {panel,status};
  };
  const button=(panel,label,run,primary=false)=>{
    const b=node('button',label);b.type='button';if(primary)b.className='pairing-primary';
    b.addEventListener('click',event=>{if(event.isTrusted&&!disposed)void run();});panel.append(b);return b;
  };
  const waiting=(title,text)=>{const view=screen(title,text);button(view.panel,'Cancel',leave);return view;};
  const fail=async()=>{
    if(disposed||finished||failed)return;failed=true;const failedPhase=phase;stop();
    screen('Checking the saved connection','Keeping your saved device data…');
    let installed=false,acknowledged=false;
    try{if(installation){await installation;installed=true;}}catch{}
    try{if(acknowledgment){await acknowledgment;acknowledged=true;}}catch{}
    if(disposed)return;
    let title='Connection did not finish',text;
    if(role==='candidate'&&acknowledged){title='Device connected';text='The connection was saved and confirmed before this screen closed.';}
    else if(role==='candidate'&&installed){title='Connection saved on this device';text='Confirmation from the other device did not finish. Keep this device’s data. Use connection recovery in Advanced; do not create a new group.';}
    else if(failedPhase==='invitation'||failedPhase==='exchange')text=relayState==='connected'
      ? 'No complete reply arrived before the invitation ended. Keep both devices open and check that the chosen relay can forward messages. Your journeys and device data are kept.'
      : 'The relay could not complete the connection. Check that both devices are online and the relay is available. Your downloaded journeys still work.';
    else text='The connection ended while checking or saving the device. Your saved data is kept. Return to My devices to check its state before trying again.';
    const result=screen(title,text);button(result.panel,'Back to my devices',leave,true);
  };
  const complete=async()=>{
    current();
    // Keep the transport open until this view is left: the other device may
    // still be receiving the durable acknowledgment sent by the provisioner.
    const result={role,peer,group:role==='candidate'?new Uint8Array((await store.read('candidate-persona','active')).value.record.group):expectedGroup.slice(),relay:connection.relay};
    current();finished=true;
    const view=screen(role==='candidate'?'Device connected':'Connection saved',role==='candidate'
      ? 'Both devices confirmed saving the connection. Choose whether to share your saved places and preferred services next.'
      : 'Your other device saved the connection. Its confirmation has been sent. Check that it shows Device connected.');
    try{await onConnected(result);}catch{if(!disposed)view.status.textContent+=' Saved setup could not be refreshed here; return to My devices.';}
    if(disposed)return;
    if(onShare)button(view.panel,'Choose what to share',()=>onShare(result),true);
    button(view.panel,'Done',leave,!onShare);
  };
  const ready=async result=>{
    current();session=result.session;payloads=result.payloads;peer=result.peer;
    phase='comparison';
    session.signal.addEventListener('abort',()=>{void fail();},{once:true});
    waiting('Checking your other device','The replies are moving automatically. Keep both devices open.');
    const code=await session.comparison();current();
    comparison=showComparison(container,{code,focus,signal:lifetime.signal,onDecision:async matched=>{
      try{
        current();if(!matched){leave();return;}
        await session.decide(true);current();
        phase='saving';waiting('Saving your device connection','Keep both devices open for confirmation.');
        if(role==='candidate'){
          await session.sendClaim();current();
          installation=session.installLocal();await installation;current();
          acknowledgment=session.acknowledgeInstallation();await acknowledgment;current();
        }else{
          const subject=await payloads.claim();current();
          const material=await invitation.enrollmentMaterial(subject);
          try{peer={member:subject.slice(),certificate:material.certificate.slice()};await payloads.sendBundle(material);}
          finally{material.destroy();}
          current();acknowledgment=payloads.acknowledgeInstalled();await acknowledgment;current();
        }
        await complete();
      }catch{void fail();}
    }});
  };
  const connect=async(text,reviewed)=>{
    current();connection=readConnectionInvitation(text);
    channel=await createInvitationChannel({invitation:text,role,signal:transportLifetime.signal,onError:()=>{void fail();},onStatus:s=>{relayState=s;}});current();
    flow=createAutomaticEnrollment({role,wasm,store,channel,invitation,reviewed,signal:lifetime.signal,onReady:ready,onError:()=>{void fail();}});
    channel.start();if(role==='candidate'){phase='exchange';await flow.start();}
  };
  const review=text=>{
    try{connection=readConnectionInvitation(text);}catch{const v=screen('Invitation expired or unreadable','Create a new invitation on your other device, then scan it again.');button(v.panel,'Back',leave,true);return;}
    const view=screen('Connect to your other device?','Continue only if this invitation is from Along on a device you control. You will compare a code on both screens.');
    view.panel.append(node('p','Use this relay for the connection:'),node('code',connection.relay));
    const details=node('details');details.append(node('summary','Connection and privacy'),node('p','The relay sees network addresses, temporary identifiers and traffic timing. Connection messages are encrypted. No AT key is shared. Browser keys use software protection; code running as part of Along can use them.'));
    view.panel.append(details);
    const use=button(view.panel,'Connect and compare codes',async()=>{
      if(busy)return;busy=true;use.disabled=true;
      try{
        let saved=await store.read('candidate-persona','active');current();
        if(!saved){const initial=await initializeLocalPersona({wasm,store,signal:lifetime.signal});initial.close();current();saved=await store.read('candidate-persona','active');current();}
        const localGroup=Array.from(saved.value.record.group,b=>b.toString(16).padStart(2,'0')).join('');
        const custody=await store.read('along-browser-issuer',localGroup);current();
        if(saved.value.origin!=='initial'||saved.value.claim!=='open'||custody?.value){
          const v=screen('Check this device’s connection','This device already has a device group. It has been kept, together with your saved journeys. Return to My devices to manage or recover that connection.');button(v.panel,'Back to my devices',leave,true);return;
        }
        waiting('Connecting to your other device','Keep both screens open. The replies are sent automatically.');
        await connect(text,{descriptor:connection.descriptor,signal:lifetime.signal});
      }catch{void fail();}
    },true);
    button(view.panel,'Cancel',leave);
  };
  if(role==='provisioner'){
    const view=screen('Connect another device','Choose your relay, then show one invitation on this screen. Keep both devices open.');
    const label=node('label','Relay server address'),input=node('input');input.type='url';input.value=relay;input.autocomplete='off';input.spellcheck=false;label.append(input);view.panel.append(label);
    const create=button(view.panel,'Create invitation',async()=>{
      if(busy)return;
      try{hiveEndpoint(input.value.trim());}catch{view.status.textContent='Enter a secure wss:// relay address without a password, query or fragment.';input.focus();return;}
      busy=true;create.disabled=true;
      try{
        invitation=await createSoftwareInvitation({wasm,store,expectedGroup,signal:lifetime.signal});current();
        const text=await createConnectionInvitation({descriptor:invitation.descriptor,relay:input.value.trim()});current();
        const link=connectionInvitationLink(appURL,text);
        const v=waiting('Scan with your other device','Open this invitation on your other device, then confirm the matching codes. It expires after one minute.');
        const qr=node('div');v.panel.insertBefore(qr,v.panel.lastChild);renderTransferQr(qr,link);
        const alternative=node('details');alternative.append(node('summary','Use an invitation link instead'));
        const copyLabel=node('label','Invitation link'),copy=node('textarea');copy.readOnly=true;copy.rows=3;copy.value=link;copyLabel.append(copy);alternative.append(copyLabel);
        button(alternative,'Copy invitation link',async()=>{try{await doc.defaultView.navigator.clipboard.writeText(link);v.status.textContent='Invitation copied. Open it on your other device.';}catch{copy.focus();copy.select();v.status.textContent='Select and copy the invitation link.';}});
        v.panel.insertBefore(alternative,v.panel.lastChild);
        await connect(text);
      }catch{void fail();}
    },true);button(view.panel,'Cancel',leave);
  }else if(connectionText){review(connectionText);}
  else{
    const view=screen('Scan your other device','On your other device, choose Connect another device. Scan its invitation here or open its invitation link.');
    const label=node('label','Invitation link'),input=node('textarea');input.rows=3;input.maxLength=12288;input.autocomplete='off';input.spellcheck=false;label.append(input);
    const area=node('div');
    const scan=button(view.panel,'Scan invitation',async()=>{
      if(scan.disabled)return;scan.disabled=true;const previous=input.value;
      try{
        await scanTransferQr(area,input,lifetime.signal);
        if(!disposed&&input.value!==previous){
          try{review(invitationFromLink(input.value.trim()));}
          catch{view.status.textContent='This code is not a current Along invitation. Create a new invitation on your other device.';input.focus();}
        }
      }catch{if(!disposed)view.status.textContent='Scanning is unavailable. Paste the invitation link below.';}
      finally{scan.disabled=false;}
    },true);
    view.panel.append(area,label);
    button(view.panel,'Review invitation',()=>{try{review(invitationFromLink(input.value.trim()));}catch{view.status.textContent='This invitation could not be read. Copy a new invitation link from your other device.';input.focus();}});
    button(view.panel,'Cancel',leave);
  }
  return Object.freeze({dispose});
}
