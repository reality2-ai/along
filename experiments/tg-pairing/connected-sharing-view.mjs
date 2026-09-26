// One deliberate sharing choice for the peer verified during enrollment.
// Granting journey access does not grant AT-key access or prove any delivery.
import {readJourneyPermission,setJourneyPermission} from '../journey-sync/permission.mjs';
import {readRelayConfiguration,saveRelayConfiguration} from '../relay/configuration.mjs';
export function showConnectedSharing(container,{wasm,store,expectedGroup,peer,relay,focus=false,onBack=()=>{},onChanged=()=>{}}){
  const doc=container.ownerDocument,lifetime=new AbortController();let disposed=false,busy=false,permission,config;
  const group=expectedGroup.slice(),subject=peer.member.slice(),certificate=peer.certificate.slice();
  const node=(tag,text='')=>{const n=doc.createElement(tag);n.textContent=text;return n;};
  const panel=node('section');panel.className='pairing-comparison';
  const heading=node('h2','Share with this device?');heading.tabIndex=-1;
  const explanation=node('p','Share saved starting and destination places, preferred bus/train/ferry services, and later changes or removals. Your other device must also agree.');
  const connection=node('p','Automatically reconnect through '+relay+' while Along is open and online.');
  const details=node('details');details.append(node('summary','What stays private?'),node('p','Your current location, searches and learning history stay on this device. AT-key sharing is a separate choice and is not enabled here. The relay sees connection metadata; saved journeys are encrypted between permitted devices. The connection also carries encrypted, signed group-removal notices so devices can stop trusting a removed member. Replacement group keys need a separate approved update.'));
  const status=node('p','Checking your saved choice…');status.setAttribute('role','status');status.setAttribute('aria-atomic','true');
  const share=node('button','Share and reconnect');share.type='button';share.className='pairing-primary';share.disabled=true;
  const back=node('button','Not now');back.type='button';
  panel.append(heading,explanation,connection,details,status,share,back);container.replaceChildren(panel);
  const dispose=()=>{if(disposed)return;disposed=true;lifetime.abort();share.disabled=true;};
  const leave=()=>{dispose();onBack();};back.addEventListener('click',leave);
  panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();leave();}});
  const current=()=>{if(disposed||lifetime.signal.aborted)throw Error('Sharing review closed');};
  const ready=(async()=>{
    try{
      permission=await readJourneyPermission({wasm,store,expectedGroup:group});current();
      config=await readRelayConfiguration({store,expectedGroup:group,member:permission.member});current();
      share.disabled=false;
      const remote=Array.from(subject,b=>b.toString(16).padStart(2,'0')).join('');
      status.textContent=permission.peers.includes(remote)?'Sharing permission is already saved here. Choose Share and reconnect to use this relay.':'Nothing is shared by this setup until you choose Share and reconnect.';
    }catch{if(!disposed)status.textContent='The saved sharing choice could not be checked. Keep your device data and return to My devices.';}
  })();
  share.addEventListener('click',async event=>{
    if(!event.isTrusted||disposed||busy||share.disabled)return;busy=true;share.disabled=true;
    status.textContent='Saving your sharing choice…';
    let permissionSaved=false;
    try{
      await setJourneyPermission({wasm,store,expectedGroup:group,peer:subject,certificate,allow:true,expectedRevision:permission.revision,signal:lifetime.signal});
      permissionSaved=true;current();
      await saveRelayConfiguration({wasm,store,expectedGroup:group,member:permission.member,expectedRevision:config.revision,url:relay,enabled:true,signal:lifetime.signal});current();
      heading.textContent='Sharing enabled on this device';
      status.textContent='Choose sharing on your other device too. When both devices are online with Along open, permitted changes can reconnect automatically. Offline changes stay here until then.';
      share.hidden=true;back.textContent='Done';await onChanged();if(!disposed)back.focus();
    }catch{
      if(!disposed){status.textContent=permissionSaved
        ? 'Sharing permission was saved, but automatic reconnection could not be confirmed. Return to My devices to check it. Your saved places are kept.'
        : 'The sharing choice could not be confirmed. Return to My devices to review the saved state. Your saved places are kept.';back.textContent='Back to my devices';back.focus();}
    }finally{busy=false;}
  });
  if(focus)heading.focus();return Object.freeze({ready,dispose});
}
