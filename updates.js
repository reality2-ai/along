function workerVersion(worker){
  return new Promise((resolve,reject)=>{
    if(!worker){reject(new Error('No active app version was found.'));return;}
    const channel=new MessageChannel();
    const timeout=setTimeout(()=>{channel.port1.close();reject(new Error('The active app did not confirm its version. Keep this page open and try again.'));},5000);
    channel.port1.onmessage=({data})=>{clearTimeout(timeout);channel.port1.close();resolve(String(data.version));};
    worker.postMessage({type:'GET_VERSION'},[channel.port2]);
  });
}

function settled(worker) {
  if(worker?.state==='redundant')return Promise.reject(new Error('The new version could not be installed. Your existing app is still available.'));
  if(!worker || ['installed','activated'].includes(worker.state)) return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{cleanup();reject(new Error('The update is taking longer than expected. Try again while online.'));},30000);
    const cleanup=()=>{clearTimeout(timeout);worker.removeEventListener('statechange',changed);};
    const changed=()=>{if(worker.state==='redundant'){cleanup();reject(new Error('The new version could not be installed. Your existing app is still available.'));}else if(['installed','activated'].includes(worker.state)){cleanup();resolve();}};
    worker.addEventListener('statechange',changed);changed();
  });
}

async function activate(registration) {
  await settled(registration.installing);
  const waiting=registration.waiting;
  if(!waiting) return;
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{cleanup();reject(new Error('Could not activate the update. Please try again.'));},15000);
    const cleanup=()=>{clearTimeout(timeout);waiting.removeEventListener('statechange',changed);};
    const changed=()=>{
      if(waiting.state==='activated'){cleanup();resolve();}
      else if(waiting.state==='redundant'){cleanup();reject(new Error('This update was replaced. Please try again.'));}
    };
    waiting.addEventListener('statechange',changed);
    waiting.postMessage({type:'ACTIVATE_UPDATE'});changed();
  });
}

export function setupUpdates(registration) {
  const notice=document.getElementById('app-update'),button=document.getElementById('apply-update');
  let newerActive=false;
  const show=()=>{notice.hidden=!(newerActive||(registration.active&&registration.waiting));};
  const inspectActive=async()=>{
    try{
      const version=await workerVersion(registration.active);
      const displayed=document.getElementById('settings').textContent.match(/App version (\d+)/)?.[1];
      newerActive=!!displayed&&version!==displayed;show();
    }catch{/* An older worker may not support version reporting. */}
  };
  const watch=()=>{const worker=registration.installing;worker?.addEventListener('statechange',show);show();};
  registration.addEventListener('updatefound',watch);watch();
  navigator.serviceWorker.addEventListener('controllerchange',inspectActive);
  let checking;
  const check=(explicit=false)=>{
    const status=document.getElementById('announcement');
    if(!navigator.onLine)return;
    if(checking)return checking;
    checking=(async()=>{
      try{
        await registration.update();await settled(registration.installing);await inspectActive();show();
        if(explicit)status.textContent=registration.waiting||newerActive?'An app update is ready. Choose Update and reopen.':'Your app is up to date.';
      }catch{/* Connectivity hints can be wrong: failed checks stay silent. */}
      finally{checking=null;}
    })();
    return checking;
  };
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});
  window.addEventListener('online',()=>check());
  window.addEventListener('pageshow',()=>check());
  window.addEventListener('focus',()=>check());
  document.getElementById('refresh')?.addEventListener('click',()=>check(true));
  // Native reload checks at startup. Standalone browsers without native
  // pull-to-refresh still check on a deliberate downward pull from the top.
  // Passive listeners preserve scrolling, zooming and browser gestures.
  let pull=null;
  document.addEventListener('touchstart',event=>{
    pull=null;
    if(event.touches.length!==1||window.scrollY>0||document.querySelector('dialog[open]')||event.target.closest?.('input,textarea,select,button,a,summary,[role="listbox"]'))return;
    const touch=event.touches[0];pull={id:touch.identifier,x:touch.clientX,y:touch.clientY,ready:false};
  },{passive:true});
  document.addEventListener('touchmove',event=>{
    if(!pull)return;
    const touch=event.touches[0];
    if(event.touches.length!==1||touch.identifier!==pull.id||Math.abs(touch.clientX-pull.x)>50){pull=null;return;}
    pull.ready=touch.clientY-pull.y>=90;
  },{passive:true});
  document.addEventListener('touchend',()=>{const ready=pull?.ready;pull=null;if(ready)check(true);},{passive:true});
  document.addEventListener('touchcancel',()=>{pull=null;},{passive:true});
  button.onclick=async()=>{
    button.disabled=true;
    try{await activate(registration);location.reload();}
    catch(error){document.getElementById('update-status').textContent=error.message;button.disabled=false;}
  };
  check();
}

const recovery=document.getElementById('recover-update');
if(recovery) recovery.onclick=async()=>{
  const status=document.getElementById('recovery-status');recovery.disabled=true;
  status.textContent='Checking and downloading the latest interface…';
  try{
    if(!('serviceWorker' in navigator))throw new Error('Open this page using the same HTTPS address as your installed Along app.');
    const before=(await navigator.serviceWorker.getRegistration(new URL('./',import.meta.url)))?.active;
    const registration=await navigator.serviceWorker.register(new URL('./sw.js',import.meta.url),{type:'module',updateViaCache:'none'});
    await registration.update();
    await settled(registration.installing);
    await activate(registration);
    await navigator.serviceWorker.ready;
    const version=await workerVersion(registration.active);
    status.textContent=before===registration.active?`Already up to date — version ${version}.`:`${before?'Updated to':'Installed'} version ${version}.`;
    const destination=new URL('./',import.meta.url);
    // The navigation must not reuse an older HTML response on a resumed window.
    destination.searchParams.set('updated',version);
    recovery.disabled=false;recovery.textContent='Open Along →';
    recovery.onclick=()=>location.replace(destination);
  }catch(error){status.textContent=error.message;recovery.disabled=false;}
};
