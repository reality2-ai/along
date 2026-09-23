// Recovery must still work if language assets are unavailable or older than this page.
const updateSources = {"update.noActive": "No active app version was found.", "update.noVersion": "The active app did not confirm its version. Keep this page open and try again.", "update.failed": "The new version could not be installed. Your existing app is still available.", "update.slow": "The update is taking longer than expected. Try again while online.", "update.activation": "Could not activate the update. Please try again.", "update.replaced": "This update was replaced. Please try again.", "update.ready": "An app update is ready. Choose Update and reopen.", "update.current": "Your app is up to date.", "update.checking": "Checking and downloading the latest interface…", "update.https": "Open this page using the same HTTPS address as your installed Along app.", "update.already": "Already up to date — version {version}.", "update.updated": "Updated to version {version}.", "update.installed": "Installed version {version}.", "update.open": "Open Along →", "update.title": "Update Along", "update.intro": "Get the latest app interface. Your saved journeys and downloaded travel data stay on this device.", "update.check": "Check for updates →", "update.browser": "Use the same browser as your installed app. After updating, close and reopen the installed app.", "update.back": "Back to Along", "update.notice": "A new version of Along is ready.", "update.apply": "Update and reopen"};
let updateLanguage=null;
const updateBindings=new Map();
function updateText(element,key,values={}){
  let phrase={text:updateSources[key].replace(/\{(\w+)\}/g,(_,name)=>String(values[name])),lang:'en-NZ'};
  try{if(updateLanguage)phrase=updateLanguage.phrase(key,values);}catch{/* Keep recovery usable with an older catalogue. */}
  element.textContent=phrase.text;element.lang=phrase.lang;
  updateBindings.set(element,{key,values,text:phrase.text});
}
function updateError(key){const error=new Error(updateSources[key]);error.updateKey=key;return error;}
function updateFailure(element,error){
  if(error.updateKey)updateText(element,error.updateKey);
  else {updateBindings.delete(element);element.lang='en-NZ';element.textContent=error.message;}
}
function bindUpdateLanguage(localizer){
  updateLanguage=localizer;
  const refresh=()=>{for(const [element,binding] of updateBindings){if(element.textContent===binding.text)updateText(element,binding.key,binding.values);else updateBindings.delete(element);}};
  localizer.subscribe(refresh);refresh();
}
function workerVersion(worker){
  return new Promise((resolve,reject)=>{
    if(!worker){reject(updateError('update.noActive'));return;}
    const channel=new MessageChannel();
    const timeout=setTimeout(()=>{channel.port1.close();reject(updateError('update.noVersion'));},5000);
    channel.port1.onmessage=({data})=>{clearTimeout(timeout);channel.port1.close();resolve(String(data.version));};
    worker.postMessage({type:'GET_VERSION'},[channel.port2]);
  });
}

function settled(worker) {
  if(worker?.state==='redundant')return Promise.reject(updateError('update.failed'));
  if(!worker || ['installed','activated'].includes(worker.state)) return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{cleanup();reject(updateError('update.slow'));},30000);
    const cleanup=()=>{clearTimeout(timeout);worker.removeEventListener('statechange',changed);};
    const changed=()=>{if(worker.state==='redundant'){cleanup();reject(updateError('update.failed'));}else if(['installed','activated'].includes(worker.state)){cleanup();resolve();}};
    worker.addEventListener('statechange',changed);changed();
  });
}

async function activate(registration) {
  await settled(registration.installing);
  const waiting=registration.waiting;
  if(!waiting) return;
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{cleanup();reject(updateError('update.activation'));},15000);
    const cleanup=()=>{clearTimeout(timeout);waiting.removeEventListener('statechange',changed);};
    const changed=()=>{
      if(waiting.state==='activated'){cleanup();resolve();}
      else if(waiting.state==='redundant'){cleanup();reject(updateError('update.replaced'));}
    };
    waiting.addEventListener('statechange',changed);
    waiting.postMessage({type:'ACTIVATE_UPDATE'});changed();
  });
}

export function setupUpdates(registration,localizer) {
  if(localizer)bindUpdateLanguage(localizer);
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
        if(explicit)updateText(status,registration.waiting||newerActive?'update.ready':'update.current');
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
    catch(error){updateFailure(document.getElementById('update-status'),error);button.disabled=false;}
  };
  check();
}

const recovery=document.getElementById('recover-update');
if(recovery) recovery.onclick=async()=>{
  const status=document.getElementById('recovery-status');recovery.disabled=true;
  updateText(status,'update.checking');
  try{
    if(!('serviceWorker' in navigator))throw updateError('update.https');
    const before=(await navigator.serviceWorker.getRegistration(new URL('./',import.meta.url)))?.active;
    const registration=await navigator.serviceWorker.register(new URL('./sw.js',import.meta.url),{type:'module',updateViaCache:'none'});
    await registration.update();
    await settled(registration.installing);
    await activate(registration);
    await navigator.serviceWorker.ready;
    const version=await workerVersion(registration.active);
    updateText(status,before===registration.active?'update.already':before?'update.updated':'update.installed',{version});
    const destination=new URL('./',import.meta.url);
    // The navigation must not reuse an older HTML response on a resumed window.
    destination.searchParams.set('updated',version);
    recovery.disabled=false;updateText(recovery,'update.open');
    recovery.onclick=()=>location.replace(destination);
  }catch(error){updateFailure(status,error);recovery.disabled=false;}
};

if(recovery){
  for(const element of document.querySelectorAll('[data-update-text]'))updateText(element,element.dataset.updateText);
  import('./i18n.js').then(({createLocalizer})=>{
    const localizer=createLocalizer();bindUpdateLanguage(localizer);
    document.documentElement.lang=localizer.tag;document.body.lang='en-NZ';
    try{document.title=localizer.text('update.title');}catch{}
    const disclaimer=document.getElementById('recovery-draft');if(disclaimer)disclaimer.hidden=localizer.language!=='mi';
  }).catch(()=>{});
}
