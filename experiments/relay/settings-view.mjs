import {readRelayConfiguration,saveRelayConfiguration} from './configuration.mjs';
import {relayEndpoint} from './transport.mjs';

// A saved choice never grants another device permission. No default endpoint.
export function showRelaySettings(container,{wasm,store,expectedGroup,member,focus=false,onBack=()=>{},onChanged=()=>{}}){
  const document=container.ownerDocument,controller=new AbortController();
  let disposed=false,busy=false,saved;
  const node=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
  const panel=node('section','');panel.className='pairing-comparison';
  const heading=node('h2','Automatically reconnect my devices');heading.tabIndex=-1;
  const intro=node('p','Choose an optional R2 relay to help your already paired devices find each other while Along is open and online. Use the same relay on each device. Planning and direct AT access work independently of it.');
  const label=node('label','Relay server address');
  const input=node('input','');input.type='url';input.placeholder='wss://your-relay.example';input.autocomplete='off';input.spellcheck=false;label.append(input);
  const details=node('details','');details.append(node('summary','What does the relay see?'),node('p','The relay sees your network address, group and device identifiers, membership certificates, and connection timing and traffic sizes. Shared saved journeys are encrypted between permitted devices. The connection also carries encrypted, signed group-removal notices so devices can stop trusting a removed member. Replacement group keys need a separate approved update. Your AT key, learning history and current location are not sent by this connection.'),node('p','This uses Along’s browser-only R2 subset. It does not provide hardware-backed key storage. A relay cannot pair devices or grant sharing permission. Devices at different recovery checkpoints still need a checkpoint transfer and review. Mobile browsers may suspend Along in the background.'));
  const status=node('p','Checking the saved relay choice…');status.setAttribute('role','status');
  const button=(text,run)=>{const b=node('button',text);b.type='button';b.disabled=true;b.addEventListener('click',e=>{if(e.isTrusted&&!disposed&&!busy)void run();});return b;};
  const update=()=>{
    input.disabled=busy||!saved;enable.disabled=busy||!saved;stop.disabled=busy||!saved?.enabled;remove.disabled=busy||!saved?.url;
    enable.textContent=saved?.enabled?'Save relay and reconnect':'Use this relay';
  };
  const save=async(mode)=>{
    if(!saved)return;
    let url=saved.url;
    if(mode==='enable')try{url=relayEndpoint(input.value.trim());}catch{status.textContent='Enter a secure wss:// relay address without a username, password, query or fragment.';input.focus();return;}
    busy=true;update();status.textContent='Saving your relay choice…';
    try{
      const result=await saveRelayConfiguration({wasm,store,expectedGroup,member,expectedRevision:saved.revision,url,enabled:mode==='enable',remove:mode==='remove',signal:controller.signal});
      if(disposed)return;saved=result;input.value=saved.url||'';
      status.textContent=mode==='enable'?'Relay enabled on this device. Connection status is shown when you go Back.':mode==='remove'?'Relay address removed. Saved journeys remain on this device.':'Automatic relay sharing stopped. The address is kept for later.';
      await onChanged();
    }catch{if(!disposed)status.textContent='The relay choice could not be confirmed. Go Back and reopen this screen to check it. Your saved journeys are kept.';}
    finally{busy=false;if(!disposed){update();input.focus();}}
  };
  const enable=button('Use this relay',()=>save('enable'));enable.className='pairing-primary';
  const stop=button('Stop automatic relay sharing',()=>save('stop'));
  const remove=button('Remove relay address',()=>save('remove'));
  const dispose=()=>{if(disposed)return;disposed=true;controller.abort();panel.remove();};
  const leave=()=>{dispose();onBack();};
  const back=node('button','Back');back.type='button';back.addEventListener('click',leave);
  panel.append(heading,intro,label,details,status,enable,stop,remove,back);container.append(panel);
  panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();leave();}});
  if(focus)heading.focus();
  const ready=(async()=>{try{saved=await readRelayConfiguration({store,expectedGroup,member});if(disposed)return;input.value=saved.url||'';status.textContent=saved.enabled?'Automatic relay sharing is enabled for this address.':saved.url?'Automatic relay sharing is stopped.':'No relay is enabled. Pair devices and allow journey sharing before using a relay.';update();}catch{if(!disposed)status.textContent='The saved relay choice could not be read. Go Back and try again.';}})();
  return Object.freeze({ready,dispose});
}
