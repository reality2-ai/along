import {vehiclePosition} from './live-vehicles.js';
import {contextualAlerts} from './live-context.js';
import {stopAlertContexts,journeyAlertContexts,aucklandWallEpoch} from './live-time.js';
import {departurePrediction} from './live-predictions.js';
import {createLiveClient} from './live-client.js';
import {liveBaseURL} from './live-config.js';
import {setupFeedback} from './feedback-ui.js';
import {createLocalizer, setLocalizedText, errorPhraseKey} from './i18n.js';
import {setupUpdates} from './updates.js';
import {aucklandNow} from './planner.js';
import {readPreferences,writePreferences,recordJourney,suggestions,journeyRoutes,sameRoutes} from './preferences.js';
const $=id=>document.getElementById(id);
const language=createLocalizer({storage:null});
const liveClient=createLiveClient({baseURL:liveBaseURL,pageURL:import.meta.url});
const journeyAlertClient=createLiveClient({baseURL:liveBaseURL,pageURL:import.meta.url});
let journeyAlertSequence=0,journeyAlertTimer=null,journeyPredictionTimer=null,nearbyLiveTimer=null;
$('nearby-live').hidden=!liveClient.configured;
$('nearby-live-help').hidden=!liveClient.configured;
const textBindings=new Map();
function showError(id,error){const key=errorPhraseKey(error);if(key){translated(id,key);return;}textBindings.delete(id);$(id).lang='en-NZ';$(id).textContent=error.message;}
const translated=(id,key,values)=>{const phrase=setLocalizedText($(id),language,key,typeof values==='function'?values():values);textBindings.set(id,{key,values,text:phrase.text});return phrase;};
// Acknowledgement is local to this browser, separate from journey learning.
function collapseCourseNotice(focus=false){
  const notice=$('course-notice');notice.open=false;
  document.querySelector('footer').append(notice);$('course-understood').hidden=true;
  if(focus)$('flow-title').focus({preventScroll:true});
}
try{if(localStorage.getItem('along-course-notice-v1')==='understood')collapseCourseNotice();}catch{}
$('course-understood').onclick=()=>{
  try{localStorage.setItem('along-course-notice-v1','understood');}catch{}
  collapseCourseNotice(true);
};

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Dynamic leaf phrases retain their binding so a language change does not rebuild
// cards, close disclosures, replace focused controls or disturb route detail IDs.
const message=(key,values={})=>{const phrase=language.phrase(key,values);return `<span data-i18n="${escape(key)}" data-i18n-values="${escape(JSON.stringify(values))}" lang="${phrase.lang}">${escape(phrase.text)}</span>`;};
const clock=seconds=>{const s=((seconds%86400)+86400)%86400;return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor(s%3600/60)).padStart(2,'0')}${seconds>=86400?' +1 day':''}`;};
const minutes=seconds=>Math.ceil(seconds/60);
const state={from:null,to:null,location:null,locationLabel:'',journeys:[],preferences:readPreferences(),ready:false,stored:false,shellReady:false,streetsReady:false,streetsStored:false,showAllStops:false,nearbySequence:0,searchSequence:0,lastSearch:null,screen:'destination',intent:'plan',selectedJourney:null,legIndex:0,savedPreference:null};
const worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
let requestId=0;
const pending=new Map();
worker.onmessage=({data})=>{const promise=pending.get(data.id);if(!promise)return;pending.delete(data.id);data.error?promise.reject(new Error(data.error)):promise.resolve(data.result);};
worker.onerror=()=>{for(const p of pending.values())p.reject(new Error('The route engine could not start. Reload Along to try again.'));pending.clear();};
function ask(type,args={}){return new Promise((resolve,reject)=>{const id=++requestId;pending.set(id,{resolve,reject});worker.postMessage({id,type,args});});}
function accessProfile(){return {pace:Number($('walking-pace').value),avoidSteps:$('avoid-steps').checked,confirmedAccess:$('confirmed-access').checked};}
function updatePreferenceSummary(){
  const selected=[...document.querySelectorAll('.modes input:checked')].map(i=>i.value);
  const modes=selected.length===3?language.text('preference.allModes'):selected.length?selected.map(mode=>language.text(`mode.${mode}Word`)).join(', '):language.text('preference.chooseTransport');
  const access=($('avoid-steps').checked?language.text('preference.barriers'):'')+($('confirmed-access').checked?language.text('preference.confirmedOnly'):'')+($('walking-pace').value!=='1.25'?language.text('preference.moreTime'):'');
  const values={time:$('time').value||language.text('preference.now'),modes,access};
  translated('preference-summary','preference.summary',values);
  translated('active-preferences','preference.summary',values);
}
function walkingDirections(leg){
  if(!leg.directions)return `<p>${message('walk.stationAccess')}</p>`;
  return `<details class="walk-directions"><summary>${message('walk.directions',{metres:leg.directions.metres})}</summary><ol>${leg.directions.steps.map(s=>`<li>${escape(s.name)} · ${s.metres} m${s.estimated?message('walk.estimated'):''}</li>`).join('')}</ol><p>${message('walk.checkSigns')}</p></details>`;
}
async function loadStreets(refresh=false){
  $('address-status').hidden=false;translated('address-status','status.streetsPreparing');
  try{const result=await ask('streets',{refresh});state.streetsReady=true;state.streetsStored=result.stored;updateStatus();translated('address-status',result.stored?'status.streetsReady':'status.streetsSession');$('preparation-hint').hidden=true;$('offline-info').insertAdjacentHTML('beforeend',' '+message(result.stored?'status.addressesStored':'status.addressesSession',{count:result.addresses.toLocaleString()}));}
  catch(error){showError('address-status',error);translated('preparation-hint','status.noAddresses');updateStatus();}
}
const mobility=state.preferences.mobility||{};
if([300,600,900,1200].includes(mobility.maxWalk))$('max-walk').value=mobility.maxWalk;
if([0.8,1,1.25].includes(mobility.pace))$('walking-pace').value=mobility.pace;
$('avoid-steps').checked=!!mobility.avoidSteps;$('confirmed-access').checked=!!mobility.confirmedAccess;
for(const id of ['max-walk','walking-pace','avoid-steps','confirmed-access'])$(id).addEventListener('change',async()=>{state.preferences.mobility={...accessProfile(),maxWalk:Number($('max-walk').value)};await persist();updatePreferenceSummary();if(state.location)refreshNearby();});
for(const input of document.querySelectorAll('#date,#time,.modes input'))input.addEventListener('change',updatePreferenceSummary);
$('leave-now').onclick=setNow;
$('more-stops').onclick=()=>{state.showAllStops=!state.showAllStops;if(state.departureData)renderDepartures(state.departureData);};
const context=()=>{const at=aucklandNow();return {hour:Number(at.time.slice(0,2)),day:new Date(at.date+'T12:00:00Z').getUTCDay(),timestamp:Date.now()};};
let preferencesSaving=false;
async function persist(){
  if(preferencesSaving){translated('storage-message','storage.failed');return false;}
  preferencesSaving=true;
  const focused=document.activeElement;
  const controls=['save-places','prefer-services','clear-history','learning-enabled','max-walk','walking-pace','avoid-steps','confirmed-access'].map(id=>[$(id),$(id).disabled]);
  for(const [control] of controls)control.disabled=true;
  let saved=false;
  try{saved=await writePreferences(state.preferences);}catch{}
  finally{preferencesSaving=false;state.preferences=readPreferences();for(const [control,disabled] of controls)control.disabled=disabled;if(document.activeElement===document.body&&controls.some(([control])=>control===focused)&&focused.getClientRects().length)focused.focus({preventScroll:true});}
  if(!saved){const profile=state.preferences.mobility||{};$('max-walk').value=profile.maxWalk||900;$('walking-pace').value=profile.pace||1.25;$('avoid-steps').checked=!!profile.avoidSteps;$('confirmed-access').checked=!!profile.confirmedAccess;}
  if(saved)$('storage-message').textContent='';else translated('storage-message','storage.failed');
  $('preference-write-status').hidden=saved;if(!saved)translated('preference-write-status','storage.failed');
  renderUsual();return saved;
}
function serviceMarkup(routes){return routes.length?routes.map(r=>`${message('mode.'+r.mode+'Title')} ${escape(r.route)}`).join(' → '):message('journey.walkRoll');}
let usualRefreshPending=false;
function renderUsual({background=false}={}){
  // Keep the shortcut under a keyboard user's focus stable while peer updates
  // arrive. Apply the latest list when focus leaves this group of choices.
  if(background&&$('usual-journeys').contains(document.activeElement)){usualRefreshPending=true;return;}
  usualRefreshPending=false;
  const usual=suggestions(state.preferences,context());
  $('usual-journeys').innerHTML=usual.length?usual.map((j,i)=>`<button type="button" class="usual-card" data-usual="${i}"><span class="usual-icon" aria-hidden="true">${j.saved?'☆':'↗'}</span><span><strong>${escape(j.to.name)}</strong><small>${message('usual.from',{place:j.from.name})}</small><small>${j.saved?(j.savedRoutes?message('usual.saved')+' · '+serviceMarkup(j.savedRoutes):message('usual.savedJourney')):message('usual.searches',{count:j.count})}</small></span></button>`).join(''):`<div class="usual-placeholder"><span class="usual-icon" aria-hidden="true">↗</span><div><strong>${message(state.preferences.learning?'usual.begin':'usual.different')}</strong>${message(state.preferences.learning?'usual.learnHelp':'usual.pausedHelp')}</div></div>`;
  document.querySelectorAll('[data-usual]').forEach(button=>button.onclick=()=>{state.intent='plan';const trip=usual[Number(button.dataset.usual)];state.savedPreference=trip.saved&&trip.savedRoutes?{from:trip.from.id,to:trip.to.id,routes:trip.savedRoutes}:null;setPlace('origin',trip.from);setPlace('destination',trip.to);setNow();searchJourney();});
  document.querySelector('.usual-section').hidden=!usual.length;
  $('learning-enabled').checked=state.preferences.learning;
  translated('learning-note',state.preferences.learning?'learning.active':'learning.paused');
}
$('usual-journeys').addEventListener('focusout',()=>{
  if(usualRefreshPending)queueMicrotask(()=>renderUsual({background:true}));
});
function setNow(){const now=aucklandNow();$('date').value=now.date;$('time').value=now.time;updatePreferenceSummary();}
function setPlace(field,stop){state[field==='origin'?'from':'to']=stop;$(field).value=stop?.name||'';$(field+'-options').hidden=true;$(field).setAttribute('aria-expanded','false');if(field==='origin'){state.location=null;if(stop){state.location={lat:stop.lat,lon:stop.lon};state.locationLabel=stop.name;}}}
function renderFlowLanguage(){
  const screen=state.screen;
  translated('flow-title',`flow.${screen==='review'&&state.intent==='nearby'?'reviewNearby':screen}.title`);
  translated('flow-progress',`flow.${screen}.progress`);
  if(screen==='origin'&&state.to&&state.intent==='plan')translated('flow-context','flow.destinationSelected',{place:state.to.name});
  else {$('flow-context').textContent=['options','follow','arrived'].includes(screen)&&state.lastSearch?`${state.lastSearch.from.name} → ${state.lastSearch.to.name}`:'';$('flow-context').lang='en-NZ';}
  translated('origin-next',state.intent==='nearby'?'action.reviewNearby':'action.review');
  translated('find',state.intent==='nearby'?'action.findNearby':'action.find');
}
function applyBindings(root=document){
  for(const element of root.querySelectorAll('[data-i18n]'))setLocalizedText(element,language,element.dataset.i18n,element.dataset.i18nValues?JSON.parse(element.dataset.i18nValues):{});
  for(const element of root.querySelectorAll('[data-i18n-aria]')){
    const phrase=language.phrase(element.dataset.i18nAria);element.setAttribute('aria-label',phrase.text);element.lang=phrase.lang;if(element.hasAttribute('title'))element.title=phrase.text;
  }
  for(const element of root.querySelectorAll('[data-i18n-placeholder]')){
    const phrase=language.phrase(element.dataset.i18nPlaceholder);element.placeholder=phrase.text;element.lang=phrase.lang;
  }
}
function applyLanguage(){
  document.documentElement.lang=language.tag;
  document.body.lang='en-NZ';
  applyBindings();
  for(const [id,binding] of textBindings){
    // A cleared or replaced status must not reappear when the language changes.
    if($(id)?.textContent===binding.text)translated(id,binding.key,binding.values);
    else textBindings.delete(id);
  }
  renderFlowLanguage();updatePreferenceSummary();renderSavedPlaces();
}

let navDepth=0;
function showScreen(screen,{focus=true,historyEntry=true}={}){
  if(state.screen==='follow' && screen!=='follow')resetJourneyAlerts();
  if(screen!=='options'&&state.screen==='options'){state.searchSequence++;$('find').disabled=false;}
  if(state.screen==='nearby' && screen!=='nearby'){clearTimeout(nearbyLiveTimer);state.nearbySequence++;liveClient.cancel();$('nearby-live').disabled=false;$('refresh').disabled=false;}
  state.screen=screen;
  for(const section of document.querySelectorAll('[data-screen]'))section.hidden=section.dataset.screen!==screen;
  $('journey-form').hidden=!['destination','origin','review'].includes(screen);
  renderFlowLanguage();
  $('app-purpose').hidden=screen!=='destination';
  $('flow-progress').closest('nav').hidden=screen==='destination';
  $('new-journey').hidden=screen==='destination';$('flow-back').hidden=screen==='destination';
  $('review-origin').textContent=state.from?.name||'Choose a starting place';$('review-destination').textContent=state.to?.name||'';
  $('review-destination-row').hidden=state.intent==='nearby';$('swap').hidden=state.intent==='nearby';
  renderSavedPlaces();
  $('try-britomart').hidden=state.intent!=='nearby';
  $('journey-notes').hidden=!['options','follow'].includes(screen);
  $('journey-feedback').hidden=!['options','follow'].includes(screen);
  $('form-error').textContent='';
  for(const field of ['origin','destination']){$(field+'-options').hidden=true;$(field).setAttribute('aria-expanded','false');$(field).removeAttribute('aria-activedescendant');}
  if(historyEntry){navDepth++;history.pushState({alongScreen:screen,depth:navDepth,intent:state.intent},'');}
  if(focus)$('flow-title').focus();
}
window.addEventListener('popstate',event=>{
  if(event.state?.alongDetail){
    if(event.state.alongDetail===activeDetail && $('information').open && ($('information').classList.contains('map-expanded') || event.state.alongMap)){setMapExpanded(!!event.state.alongMap);return;}
    displayDetail(event.state.alongDetail).then(()=>{if(event.state.alongMap)setMapExpanded(true);});return;
  }
  if($('information').open){const target=detailViews.get(activeDetail)?.returnFocus;$('information').close();if(contextMap){contextMap.remove();contextMap=null;}activeDetail=null;if(target?.isConnected)target.focus();return;}

  navDepth=event.state?.depth||0;state.intent=event.state?.intent||'plan';
  let screen=event.state?.alongScreen||'destination';
  if(['follow','arrived'].includes(screen)&&!state.selectedJourney)screen='options';
  showScreen(screen,{historyEntry:false});
});
$('flow-back').onclick=()=>{if(navDepth)history.back();else showScreen('destination');};
function startNew(){state.savedPreference=null;state.searchSequence++;state.nearbySequence++;$('find').disabled=false;state.intent='plan';setPlace('origin',null);setPlace('destination',null);state.journeys=[];state.lastSearch=null;state.selectedJourney=null;$('direct-only').checked=false;setNow();showScreen('destination');}
function review(){showScreen('review');}
function nearby(){showScreen('nearby');refreshNearby();}
$('nearby-start').onclick=()=>{state.intent='nearby';showScreen('origin');};
$('edit-origin').onclick=()=>showScreen('origin');$('edit-destination').onclick=()=>showScreen('destination');
$('change-search').onclick=review;$('nearby-edit').onclick=()=>{state.intent='nearby';review();};
$('nearby-from-options').onclick=()=>{state.intent='nearby';nearby();};
$('nearby-plan').onclick=()=>{state.intent='plan';showScreen('destination');};
$('another-journey').onclick=startNew;
$('return-journey').onclick=()=>{const last=state.lastSearch;state.savedPreference=null;state.intent='plan';setPlace('origin',last.to);setPlace('destination',last.from);setNow();review();};
for(const field of ['origin','destination']){
  const input=$(field),list=$(field+'-options');let timer,sequence=0,items=[],active=-1;
  const close=()=>{list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');};
  const choose=index=>{if(!items[index])return;sequence++;setPlace(field,items[index]);close();};
  input.addEventListener('input',()=>{state[field==='origin'?'from':'to']=null;if(field==='origin'){state.location=null;state.nearbySequence++;}const current=++sequence;clearTimeout(timer);timer=setTimeout(async()=>{
    if(input.value.trim().length<2){close();return;}
    try{const result=await ask('search',{query:input.value});if(current!==sequence)return;items=result;active=-1;
      list.innerHTML=items.length?items.map((s,i)=>`<li role="option" aria-selected="false" id="${field}-option-${i}" data-index="${i}">${escape(s.name)}<small>${message(s.placeType==='address'?'place.addressType':s.kind===1?'place.stationType':'place.stopType',{code:s.code||s.id})}</small></li>`).join(''):`<li role="option" aria-disabled="true">${message('place.noMatch')}</li>`;
      list.hidden=false;input.setAttribute('aria-expanded','true');
      list.querySelectorAll('[data-index]').forEach(item=>{item.addEventListener('pointerdown',event=>event.preventDefault());item.addEventListener('click',()=>choose(Number(item.dataset.index)));});
    }catch(error){showError('form-error',error);}
  },170);});
  input.addEventListener('keydown',event=>{if(event.key==='Escape'){close();return;}if(list.hidden)return;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();active=Math.max(0,Math.min(items.length-1,active+(event.key==='ArrowDown'?1:-1)));list.querySelectorAll('[data-index]').forEach((el,i)=>el.setAttribute('aria-selected',String(i===active)));if(active>=0){input.setAttribute('aria-activedescendant',`${field}-option-${active}`);$(field+'-option-'+active)?.scrollIntoView({block:'nearest'});}}
    if(event.key==='Enter'&&active>=0){event.preventDefault();choose(active);}
  });input.addEventListener('blur',()=>setTimeout(close,120));
}
$('swap').onclick=()=>{const from=state.from,to=state.to;setPlace('origin',to);setPlace('destination',from);showScreen('review',{focus:false,historyEntry:false});};
$('new-journey').onclick=startNew;
$('journey-form').onsubmit=event=>{
  event.preventDefault();$('form-error').textContent='';
  if(state.screen==='destination'){
    if(!state.to){translated('form-error','error.destination');$('destination').focus();return;}
    state.intent='plan';showScreen(state.from?'review':'origin');
  }else if(state.screen==='origin'){
    if(!state.from){translated('form-error','error.origin');$('origin').focus();return;}
    review();
  }else if(state.screen==='review'){
    if(state.intent==='nearby')nearby();else searchJourney();
  }
};
async function searchJourney(){
  const from=state.from,to=state.to;$('form-error').textContent='';
  if(state.savedPreference&&(state.savedPreference.from!==from?.id||state.savedPreference.to!==to?.id))state.savedPreference=null;
  if(!from||!to){translated('form-error','error.places');return;}
  const modes=[...document.querySelectorAll('.modes input:checked')].map(i=>i.value);
  state.lastSearch={from,to,date:$('date').value,time:$('time').value};
  showScreen('options');
  const date=$('date').value,time=$('time').value,sequence=++state.searchSequence;
 $('find').disabled=true;$('journeys').innerHTML=`<div class="loading">${message('journey.loading')}</div>`;
  try{
    const journeys=await ask('plan',{from,to,date,time,modes,maxWalk:Number($('max-walk').value),profile:accessProfile(),preferredRoutes:state.savedPreference?.routes});if(sequence!==state.searchSequence)return;
    state.journeys=journeys;state.lastSearch={from,to,date,time};translated('journey-title',journeys.length?(journeys.length===1?'journey.oneWay':'journey.ways'):'journey.noneWindow',{count:journeys.length});
    if(journeys.length){state.preferences=recordJourney(state.preferences,from,to,{hour:Number(time.slice(0,2)),day:new Date(date+'T12:00:00Z').getUTCDay(),timestamp:Date.now()});await persist();}if(sequence!==state.searchSequence)return;renderJourneys();translated('announcement',journeys.length?'journey.announced':'journey.noneAnnounced',{count:journeys.length,time:journeys.length?clock(journeys[0].arrival):''});$('journey-title').focus();
  }catch(error){if(sequence===state.searchSequence){showScreen('review');showError('form-error',error);$('form-error').focus();}}
  finally{if(sequence===state.searchSequence)$('find').disabled=false;}
}
// Detail layers keep the underlying task, scroll position and explicit journey progress.
const detailViews=new Map();let detailId=0,activeDetail=null;
$('information').addEventListener('close',()=>{$('information').classList.remove('map-expanded');for(const view of detailViews.values())view.dispose?.();});
function detailLink(label,title,body,className='detail-link'){
  const id=++detailId;detailViews.set(id,{title,body,titleKey:({'Route details':'explore.routeTitle','Walking connection':'explore.walkTitle'})[title]});
  return `<button type="button" class="${className}" data-detail="${id}" aria-haspopup="dialog">${label}</button>`;
}
function placeDetail(place){
  const label=escape(place.name),id=detailId+1;let stopRows=[],stopNow=null;
  const link=detailLink(label,place.name,async()=>{
    const now=explorationTime(),departures=place.placeType==='address'?[]:await ask('stopDetails',{id:place.id,now});
    stopRows=departures;stopNow=now;
    return `<p>${message(place.placeType==='address'?'place.addressType':'explore.stationStop')}${place.code?' · '+message('place.stopType',{code:place.code}):''}</p>${mapMarkup()}<p>${message('explore.access')}</p>${place.placeType==='address'?'':`<h3>${message('board.heading',{time:clock(now.seconds),date:now.date})}</h3><p>${message('board.limit')}</p><p><a href="https://at.govt.nz/atmobile/" target="_blank" rel="noopener noreferrer">${message('board.at')}</a> <small>${message('board.online')}</small></p>${liveClient.configured?'<button type="button" class="secondary-button" id="stop-live">Check live times and alerts</button><p class="field-help">Optional online check. Your journey details stay on this device; the server receives your IP address.</p><p id="stop-live-status" class="field-help" role="status"></p><div id="stop-alerts"></div>':''}${departures.length?`<div class="departure-board"><table><caption>${message('board.caption')}</caption><thead><tr><th scope="col">${message('board.time')}</th><th scope="col">${message('board.route')}</th><th scope="col">${message('board.destination')}</th></tr></thead><tbody>${departures.map((d,i)=>`<tr><td class="board-time" data-stop-time="${i}">${clock(d.departure)}</td><td>${routeLink(escape(d.route),{routeId:d.routeId,tripId:d.trip},'board-route')}</td><td>${escape(d.headsign)}</td></tr>`).join('')}</tbody></table></div>`:`<p>${message('board.none')}</p>`}`}`;
  });detailViews.get(id).mount=()=>{mountMap(null,[place]);mountStopLive(id,stopRows,stopNow,place);};return link;
}
function mountStopLive(id,rows,at,place){
  const button=$('stop-live');if(!button)return;
  const client=createLiveClient({baseURL:liveBaseURL,pageURL:import.meta.url});
  let timer=null,alertTimer=null,sequence=0;
  const caption=$('detail-body').querySelector('.departure-board caption'),scheduledCaption=caption?.textContent;
  const reset=()=>{if(caption)caption.textContent=scheduledCaption;document.querySelectorAll('[data-stop-time]').forEach((cell,i)=>{cell.textContent=clock(rows[i].departure);});};
  detailViews.get(id).dispose=()=>{sequence++;clearTimeout(timer);clearTimeout(alertTimer);client.cancel();};
  button.onclick=async()=>{
    const request=++sequence;clearTimeout(timer);clearTimeout(alertTimer);$('stop-alerts').replaceChildren();reset();button.disabled=true;
    $('stop-live-status').textContent='Checking current AT predictions…';
    const [feed,alerts]=await Promise.all([client.read('predictions',{requested:true}),client.read('alerts',{requested:true})]);
    if(request!==sequence || !button.isConnected)return;
    button.disabled=false;
    let matched=0,expires=Number(feed.updated)+180;
    document.querySelectorAll('[data-stop-time]').forEach((cell,i)=>{
      const departure=rows[i],prediction=departurePrediction(feed,departure);
      if(prediction.status==='scheduled')return;
      matched++;expires=Math.min(expires,Number(prediction.updated)+180);
      let label=prediction.status==='cancelled'?'Cancelled':prediction.status==='skipped'?'Not stopping here':'';
      if(prediction.status==='predicted'){
        let seconds=departure.departure+prediction.delay,date=at.date;
        if(prediction.epoch){const time=aucklandNow(new Date(prediction.epoch*1000));seconds=time.seconds;date=time.date;}
        if(!prediction.epoch && (seconds<0 || seconds>=86400))date=new Date(Date.parse(at.date+'T12:00:00Z')+Math.floor(seconds/86400)*86400000).toISOString().slice(0,10);
        label='Expected '+clock(seconds)+(date!==at.date?' · '+date:'');
      }
      cell.textContent=label;
      const original=document.createElement('small');original.className='board-scheduled';original.textContent='Scheduled '+clock(departure.departure);cell.append(original);
    });
    if(matched && caption)caption.textContent='Departures · scheduled and live';
    $('stop-live-status').textContent=!feed.available?'Current predictions unavailable. Showing scheduled departures.':matched?'Live information matched to '+matched+' departures. Other times remain scheduled.':'No live match for these departures. Times remain scheduled.';
    const alertBox=$('stop-alerts');
    if(alerts.available){
      const relevant=contextualAlerts(alerts,stopAlertContexts(place,rows,at));
      $('stop-live-status').textContent+=' '+relevant.length+' matching service update'+(relevant.length===1?'':'s')+'.';
      if(relevant.length){
        const disclosure=document.createElement('details'),summary=document.createElement('summary');
        summary.textContent=relevant.length+' service update'+(relevant.length===1?'':'s')+' for this stop';disclosure.append(summary);
        for(const alert of relevant){const article=document.createElement('article'),heading=document.createElement('h3'),body=document.createElement('p');article.className='alert-item';heading.textContent=alert.title;body.textContent=alert.description;article.append(heading,body);disclosure.append(article);}
        alertBox.append(disclosure);
      }else alertBox.textContent='No matching alerts returned for this stop and time.';
      alertTimer=setTimeout(()=>{if(button.isConnected)alertBox.textContent='Service updates have expired. Check again for current information.';},Math.max(0,(alerts.updated+180-Date.now()/1000)*1000));
    }else alertBox.textContent='Service alerts unavailable. Check AT for disruptions.';
    if(feed.available)timer=setTimeout(()=>{if(button.isConnected){reset();$('stop-live-status').textContent='Live information has expired. Showing scheduled departures.';}},Math.max(0,(expires-Date.now()/1000)*1000));
  };
}

function legDetail(leg,label,className){
  if(leg.mode!=='walk')return routeLink(label,{routeId:leg.routeId,tripId:leg.trip},className);
  return detailLink(label,leg.mode==='walk'?'Walking connection':`${leg.mode[0].toUpperCase()+leg.mode.slice(1)} ${leg.route}`,()=>`${legMarkup(leg)}<p>${leg.mode==='walk'?message('explore.walkEstimate'):'Times are scheduled, not live predictions.'}</p>`,className);
}
async function displayDetail(id){
  const view=detailViews.get(id);if(!view)return;
  detailViews.get(activeDetail)?.dispose?.();
  $('information').classList.remove('map-expanded');
  if(contextMap){contextMap.remove();contextMap=null;}
  activeDetail=id;if(view.titleKey)translated('detail-title',view.titleKey);else {$('detail-title').textContent=view.title;$('detail-title').lang='en-NZ';textBindings.delete('detail-title');}$('detail-body').innerHTML=`<p role="status">${message('explore.loading')}</p>`;
  if(!$('information').open)$('information').showModal();
  $('information').scrollTop=0;$('detail-title').focus();
  try{const markup=view.markup??await view.body();view.markup=markup;if(activeDetail!==id||!$('information').open)return;$('detail-body').innerHTML=markup;view.mount?.();mountVariant(view);applyBindings($('detail-body'));$('detail-body').querySelectorAll('details').forEach((d,i)=>{if(view.openDetails)d.open=!!view.openDetails[i];});if(view.restoreDetail)$('detail-body').querySelector(`[data-detail="${view.restoreDetail}"]`)?.focus();$('information').scrollTop=view.scroll||0;}
  catch(error){if(activeDetail===id)showError('detail-body',error);}
}
function openInformation(button){
  if(!button)return;
  const id=Number(button.dataset.detail),view=detailViews.get(id);if(!view)return;
  if(activeDetail){const parent=detailViews.get(activeDetail);parent.scroll=$('information').scrollTop;parent.openDetails=[...$('detail-body').querySelectorAll('details')].map(d=>d.open);parent.restoreDetail=id;}view.returnFocus=button;history.pushState({...history.state,alongDetail:id,alongMap:false},'');displayDetail(id);
}
document.addEventListener('click',event=>openInformation(event.target.closest('[data-detail]')));
$('detail-back').onclick=()=>history.back();
$('information').addEventListener('cancel',event=>{event.preventDefault();if($('information').classList.contains('map-expanded')){$('map-fullscreen').click();return;}history.back();});
function explorationTime(){return ['options','follow','arrived'].includes(state.screen)&&state.lastSearch?{date:state.lastSearch.date,time:state.lastSearch.time,seconds:Number(state.lastSearch.time.slice(0,2))*3600+Number(state.lastSearch.time.slice(3))*60}:aucklandNow();}
function mapMarkup(){return `<section class="map-shell" aria-label="Street and transport map"><div class="context-map-frame"><div id="context-map" data-i18n-aria="map.controls" class="context-map" role="region" aria-label="Map. Use arrow keys to pan and plus or minus to zoom." tabindex="0"></div><button type="button" class="map-load-button" id="map-streets"><strong>${message('map.show')}</strong><span>${message('map.internet')}</span></button></div><div class="map-actions"><button type="button" class="secondary-button" id="map-fullscreen" aria-pressed="false">Full-screen map</button><button type="button" class="secondary-button" id="map-locate">Centre on my location</button></div><p id="map-location-status" class="field-help" role="status"></p></section><p class="field-help">${message('map.help')}</p>`;}
let contextMap;
function setMapExpanded(expanded){
  const button=$('map-fullscreen');if(!button || !contextMap)return;
  $('information').classList.toggle('map-expanded',expanded);
  button.setAttribute('aria-pressed',String(expanded));button.textContent=expanded?'Close full-screen map':'Full-screen map';
  const map=contextMap;requestAnimationFrame(()=>{if(contextMap===map){map.invalidateSize({pan:false});button.focus();}});
}
function mountMap(points,stops){
  if(!$('context-map')||!globalThis.L)return;
  contextMap=L.map('context-map',{scrollWheelZoom:false,zoomAnimation:false,fadeAnimation:false,markerZoomAnimation:false});
  const map=contextMap,full=$('map-fullscreen'),locate=$('map-locate'),status=$('map-location-status');
  let locationMarker=null,accuracyCircle=null;
  full.onclick=()=>{
    if($('information').classList.contains('map-expanded')){history.back();return;}
    history.pushState({...history.state,alongMap:true},'');setMapExpanded(true);
  };
  locate.onclick=()=>{
    if(!navigator.geolocation){status.textContent='Location is not available in this browser.';return;}
    locate.disabled=true;status.textContent='Finding your location…';
    const current=()=>locate.isConnected&&contextMap===map;
    navigator.geolocation.getCurrentPosition(position=>{
      if(!current())return;locate.disabled=false;
      const {latitude,longitude,accuracy}=position.coords;
      if(!Number.isFinite(latitude)||!Number.isFinite(longitude)){status.textContent='Your location could not be determined.';return;}
      if(locationMarker)map.removeLayer(locationMarker);if(accuracyCircle)map.removeLayer(accuracyCircle);
      const point=[latitude,longitude];
      if(Number.isFinite(accuracy)&&accuracy>=0)accuracyCircle=L.circle(point,{radius:accuracy,color:'#4269a0',weight:1,fillOpacity:.1,interactive:false}).addTo(map);
      locationMarker=L.circleMarker(point,{radius:8,color:'#fff',weight:3,fillColor:'#245ba1',fillOpacity:1,interactive:false}).addTo(map);
      map.setView(point,16,{animate:false});
      status.textContent='Map centred on your location.'+(Number.isFinite(accuracy)?' Accuracy about '+Math.round(accuracy)+' metres.':'');
    },()=>{if(current()){locate.disabled=false;status.textContent='Location unavailable. Check location permission or explore the map manually.';}},{enableHighAccuracy:false,timeout:12000,maximumAge:60000});
  };
  contextMap.attributionControl.addAttribution('<span lang="en-NZ">Route and stops: Auckland Transport</span>');
  for(const [selector,key] of [['.leaflet-control-zoom-in','map.zoomIn'],['.leaflet-control-zoom-out','map.zoomOut']]){
    const button=$('context-map').querySelector(selector);button.dataset.i18nAria=key;button.title=language.text(key);
  }
  if(points?.length)L.polyline(points,{color:'#214e40',weight:5}).addTo(contextMap);
  for(const [i,s] of stops.entries()){
    const marker=L.circleMarker([s.lat,s.lon],{radius:5,color:'#214e40',fillColor:'#fff',fillOpacity:1}).addTo(contextMap);
    marker.bindTooltip(`${i+1}. ${s.name}`,{direction:'top'});
    marker.on('click',()=>{const el=document.createElement('div');el.innerHTML=placeDetail(s);openInformation(el.firstElementChild);});
  }
  const bounds=(points?.length?points:stops.map(s=>[s.lat,s.lon]));if(bounds.length)contextMap.fitBounds(bounds,{padding:[25,25],maxZoom:16});
  $('map-streets').onclick=()=>{L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'}).addTo(contextMap);$('map-streets').hidden=true;};
}
function routeLink(label,args,className='detail-link'){
  return detailLink(label,'Route details',async()=>{
    const data=await ask('routeDetails',{...explorationTime(),...args});
    if(!data.variants.length)return `<p>${escape(data.number)} · ${escape(data.name)}</p><p>${message('explore.noServices',{date:data.date})}</p>`;
    const variantLink=(v,i)=>{const id=detailId+1,link=detailLink(`${escape(v.headsign||data.name)} · ${message('explore.stopsFrom',{count:v.stops.length,place:v.stops[0].stop.name})}`,`${data.number} · ${v.headsign||data.name}`,()=>routeVariantMarkup(data,v), 'detail-link route-variant');Object.assign(detailViews.get(id),{variant:v,routeData:data});return link;};
    return `<p>${message('mode.'+data.mode+'Word')} ${escape(data.number)} · ${escape(data.name)}</p><p>${message('explore.choose',{date:data.date})}</p>${variantLink(data.variants[0],0)}${data.variants.length>1?`<details><summary>${message('explore.branches',{count:data.variants.length-1})}</summary>${data.variants.slice(1).map(variantLink).join('')}</details>`:''}`;
  },className);
}
function routeVariantMarkup(data,v){
  const run=v.runs.find(r=>r.trip===v.selectedTrip)||v.runs[0];
  return `<p>${escape(data.date)} · ${message('explore.scheduled')}</p>${mapMarkup()}${liveClient.configured?'<button type="button" class="secondary-button" id="route-vehicle">Check this service’s current position</button><p class="field-help">Optional online check for the selected departure. Your route selection stays on this device; the server receives your IP address.</p><p id="route-vehicle-status" class="field-help" role="status"></p>':''}<p>${message(v.shape?'explore.geometry':'explore.noGeometry')}</p><label class="preference-field">${message('explore.run')}<select id="route-run">${v.runs.map(r=>`<option value="${escape(r.trip)}" ${r.trip===run.trip?'selected':''}>${clock(r.departure)}</option>`).join('')}</select></label><label class="preference-field">${message('explore.filter')}<input id="route-stop-filter" data-i18n-placeholder="explore.filterHint" type="search" placeholder="For example, Symonds"></label><p class="field-help">${message('explore.filterHelp')}</p><p id="route-match-status" role="status"></p><ol class="route-stop-list">${run.stops.map((s,i)=>`<li data-stop-name="${escape(s.stop.name.toLowerCase())}"><span class="stop-schedule">${clock(s.time)}</span> ${placeDetail(s.stop)}${i===run.stops.length-1?message('explore.lastStop'):!s.pickup?message('explore.noPickup'):''}</li>`).join('')}</ol>`;
}
function mountVehicle(view){
  const button=$('route-vehicle'),status=$('route-vehicle-status'),map=contextMap;
  if(!button||!map)return;
  const client=createLiveClient({baseURL:liveBaseURL,pageURL:import.meta.url});
  let sequence=0,timer=null,marker=null;
  const clear=()=>{clearTimeout(timer);if(marker){map.removeLayer(marker);marker=null;}};
  view.dispose=()=>{sequence++;client.cancel();clear();};
  button.onclick=async()=>{
    const request=++sequence;clear();client.cancel();button.disabled=true;status.textContent='Checking this service’s current position…';
    const run=view.variant.runs.find(r=>r.trip===view.variant.selectedTrip)||view.variant.runs[0];
    const startTime=[Math.floor(run.departure/3600),Math.floor(run.departure%3600/60),run.departure%60].map(n=>String(n).padStart(2,'0')).join(':');
    const feed=await client.read('vehicles',{requested:true});
    if(request!==sequence||!button.isConnected||contextMap!==map)return;
    button.disabled=false;
    const position=vehiclePosition(feed,{trip:run.trip,routeId:view.routeData.id,serviceDate:view.routeData.date.replaceAll('-',''),startTime});
    if(!position.available){status.textContent='No current position could be matched to this departure. The scheduled route is still shown.';return;}
    const label='Vehicle position reported at '+clock(aucklandNow(new Date(position.updated*1000)).seconds);
    marker=L.circleMarker([position.lat,position.lon],{radius:10,color:'#fff',weight:3,fillColor:'#884400',fillOpacity:1}).addTo(map).bindTooltip(label,{permanent:true,direction:'top'});
    const nearest=run.stops.map(({stop})=>({stop,distance:map.distance([position.lat,position.lon],[stop.lat,stop.lon])})).sort((a,b)=>a.distance-b.distance)[0];
    const location=nearest?' About '+Math.round(nearest.distance)+' metres in a straight line from '+nearest.stop.name+'.':'';
    status.textContent=label+'.'+location+' This is a reported location, not an arrival prediction.';
    // The check is explicit: include the marker without discarding route context.
    map.fitBounds(map.getBounds().extend([position.lat,position.lon]),{animate:false,padding:[25,25]});
    timer=setTimeout(()=>{if(request===sequence){clear();status.textContent='The vehicle position has expired. Check again for a current position.';}},Math.max(0,(position.expires-Date.now()/1000)*1000));
  };
}
function mountVariant(view){
  const v=view.variant;if(!v)return;
  mountMap(v.shape,v.stops.map(s=>s.stop));
  mountVehicle(view);
  $('route-run').onchange=()=>{v.selectedTrip=$('route-run').value;view.markup=routeVariantMarkup(view.routeData,v);displayDetail(activeDetail);$('route-run')?.focus();};
  const filter=()=>{const q=$('route-stop-filter').value.toLowerCase().trim();let count=0;document.querySelectorAll('.route-stop-list li').forEach(li=>{li.hidden=!li.dataset.stopName.includes(q);if(!li.hidden)count++;});if(q)translated('route-match-status','explore.matches',{count});else $('route-match-status').textContent='';view.filter=q;};
  $('route-stop-filter').value=view.filter||'';$('route-stop-filter').oninput=filter;filter();
}
$('browse-routes').onclick=()=>{
  const label='Explore a route',button=$('browse-routes'),id=++detailId;
  detailViews.set(id,{title:label,titleKey:'explore.title',returnFocus:button,body:()=>`<label class="preference-field">${message('explore.search')}<input id="route-search" data-i18n-placeholder="explore.searchHint" type="search" placeholder="For example, 70 or Western"></label><div id="route-search-results" aria-live="polite"></div>`,mount:()=>{
    const view=detailViews.get(id);$('route-search').value=view.query||'';$('route-search-results').innerHTML=view.results||'';let request=0;$('route-search').oninput=async()=>{const sequence=++request,query=$('route-search').value;view.query=query;const results=await ask('routes',{query});if(sequence!==request||!$('route-search-results'))return;view.results=$('route-search-results').innerHTML=results.length?results.map(r=>routeLink(`${escape(r.number)} · ${escape(r.name)}`,{routeId:r.id},'detail-link route-variant')).join(''):query?`<p>${message('explore.noRoutes')}</p>`:'';};
  }});history.pushState({...history.state,alongDetail:id,alongMap:false},'');displayDetail(id);
};

function legMarkup(l){
  return `<div class="leg"><strong>${clock(l.departure)}</strong><div>${l.mode==='walk'?message('journey.walkTo',{place:l.to.name}):` ${routeLink(`${message('mode.'+l.mode+'Word')} ${escape(l.route)}`,{routeId:l.routeId,tripId:l.trip},`route-badge detail-link ${l.mode}`)} ${escape(l.headsign||l.to.name)}`}<p>${message('place.from')} ${placeDetail(l.from)}${l.from.code?' · '+escape(l.from.code):''}</p><p>${message('place.to')} ${placeDetail(l.to)} · ${clock(l.arrival)} · ${minutes(l.arrival-l.departure)} ${message('journey.minuteUnit')}</p>${l.mode==='walk'?walkingDirections(l):''}</div></div>`;
}
function renderJourneys(){
  const sort=$('sort').value,journeys=[...state.journeys].sort((a,b)=>Number(!!b.preferred)-Number(!!a.preferred)||a[sort]-b[sort]||a.arrival-b.arrival);state.displayJourneys=journeys;
  $('sort').hidden=journeys.length<2;
  $('saved-route-context').hidden=!state.savedPreference;$('use-any-route').hidden=!state.savedPreference;
  if(state.savedPreference)$('saved-route-context').innerHTML=`${message('usual.preference')} ${serviceMarkup(state.savedPreference.routes)}. ${message(journeys.some(j=>j.preferred)?'usual.match':'usual.noMatch')}`;
  if(!journeys.length){$('journeys').innerHTML=`<div class="empty-state"><h3>${message('journey.tryAnother')}</h3><p>${message('journey.nonePreferences')}</p><button class="primary-button" id="adjust-journey">${message('journey.adjust')}</button></div>`;$('adjust-journey').onclick=()=>{review();$('journey-preferences').open=true;$('journey-preferences').querySelector('summary').focus();};return;}
  const card=(j,i)=>`<article class="journey-card"><div class="journey-summary"><span class="context-tag">${message(j.preferred?'journey.savedRoute':i===0?'sort.'+sort:'journey.another')}</span><div class="journey-top"><div class="journey-times">${clock(j.departure)} → ${clock(j.arrival)}</div><div class="journey-duration">${minutes(j.duration)} <small>${message('journey.minuteUnit')}</small></div></div><p class="journey-meta">${message(j.walkOnly?'journey.walkRoll':j.transfers===0?'journey.noChanges':j.transfers===1?'journey.oneChange':'journey.changes',{count:j.transfers})} · ${message('journey.walkMinutes',{minutes:minutes(j.walking)})}</p><div class="journey-path">${j.legs.map(l=>legDetail(l,l.mode==='walk'?message('journey.walk'):`${message('mode.'+l.mode+'Title')} ${escape(l.route)}`,l.mode==='walk'?'detail-link':`route-badge detail-link ${l.mode}`)).join('<span class="path-arrow">›</span>')}</div><button class="${i===0?'primary-button':'secondary-button'}" data-follow="${i}">${message('journey.use')}</button></div></article>`;
  $('journeys').innerHTML=card(journeys[0],0)+(journeys.length>1?`<details class="alternatives"><summary>${message(journeys.length>2?'journey.otherMany':'journey.otherOne',{count:journeys.length-1})}</summary>${journeys.slice(1).map((j,i)=>card(j,i+1)).join('')}</details>`:'');
  document.querySelectorAll('[data-follow]').forEach(button=>button.onclick=()=>{state.selectedJourney=journeys[Number(button.dataset.follow)];state.legIndex=0;$('full-itinerary').open=false;renderFollow();showScreen('follow');});
}
function renderFollow(){
  resetJourneyAlerts();
  const journey=state.selectedJourney,leg=journey.legs[state.legIndex];
  $('journey-live').hidden=!journeyAlertClient.configured || !journey.legs.slice(state.legIndex).some(l=>l.trip);
  translated('step-count','follow.step',{step:state.legIndex+1,total:journey.legs.length});
  $('current-step').innerHTML=legMarkup(leg);
  $('itinerary-legs').innerHTML=journey.legs.map(legMarkup).join('');
  $('previous-leg').hidden=state.legIndex===0;
  translated('next-leg',state.legIndex===journey.legs.length-1?'follow.arrived':'action.nextStep');
  renderServicePreference();
}
function renderServicePreference(){
  const journey=state.selectedJourney;
  if(!journey||!state.lastSearch)return;
  const previousSave=state.preferences.journeys.find(j=>j.saved&&j.from.id===state.lastSearch.from.id&&j.to.id===state.lastSearch.to.id);
  const saved=!!previousSave&&sameRoutes(previousSave.savedRoutes,journeyRoutes(journey));
  translated('prefer-services',saved?'service.preferred':previousSave?.savedRoutes?'service.instead':'service.prefer');$('prefer-services').setAttribute('aria-pressed',String(saved));
}
function resetJourneyAlerts(){
  journeyAlertSequence++;clearTimeout(journeyAlertTimer);clearTimeout(journeyPredictionTimer);journeyAlertClient.cancel();
  $('journey-prediction-results').replaceChildren();
  $('journey-alert-check').disabled=false;$('journey-alert-status').textContent='';$('journey-alert-results').replaceChildren();
}
$('journey-alert-check').onclick=async()=>{
  resetJourneyAlerts();const sequence=journeyAlertSequence;
  const legs=state.selectedJourney.legs.slice(state.legIndex),date=state.lastSearch.date;
  const contexts=journeyAlertContexts(legs,date);
  $('journey-alert-check').disabled=true;$('journey-alert-status').textContent='Checking relevant service updates…';
  const [feed,predictions]=await Promise.all([journeyAlertClient.read('alerts',{requested:true}),journeyAlertClient.read('predictions',{requested:true})]);
  if(sequence!==journeyAlertSequence||state.screen!=='follow')return;
  $('journey-alert-check').disabled=false;
  const predictionBox=$('journey-prediction-results');
  let matched=0,predictionExpires=Number(predictions.updated)+180;
  for(const leg of legs.filter(l=>l.trip)){
    const prediction=departurePrediction(predictions,{...leg,stop:leg.from});
    if(prediction.status==='scheduled')continue;
    let label=prediction.status==='cancelled'?'Cancelled':prediction.status==='skipped'?'Not stopping at your boarding stop':'';
    if(prediction.status==='predicted'){
      const scheduled=aucklandWallEpoch(date,leg.departure);
      const epoch=prediction.epoch??(scheduled===null?null:scheduled+prediction.delay);
      if(epoch===null)continue;
      const expected=aucklandNow(new Date(epoch*1000));
      label='Expected '+clock(expected.seconds)+(expected.date!==date?' · '+expected.date:'');
    }
    matched++;predictionExpires=Math.min(predictionExpires,Number(prediction.updated)+180);
    const item=document.createElement('p');
    item.textContent=leg.route+' from '+leg.from.name+': '+label+'. Scheduled '+clock(leg.departure)+'.';
    predictionBox.append(item);
  }
  if(matched){
    const stamp=document.createElement('p');stamp.className='field-help';
    stamp.textContent='Live feed updated '+clock(aucklandNow(new Date(predictions.updated*1000)).seconds)+'. Your scheduled itinerary has not changed.';predictionBox.append(stamp);
    journeyPredictionTimer=setTimeout(()=>{if(sequence===journeyAlertSequence)predictionBox.textContent='Live predictions have expired. Your scheduled itinerary is still here.';},Math.max(0,(predictionExpires-Date.now()/1000)*1000));
  }else predictionBox.textContent=predictions.available?'No live departure match for the remaining steps. Times remain scheduled.':'Live departure predictions unavailable. Times remain scheduled.';
  if(!feed.available){$('journey-alert-status').textContent='Service updates unavailable. Your scheduled journey is still here.';return;}
  const alerts=contextualAlerts(feed,contexts);
  $('journey-alert-status').textContent=alerts.length?alerts.length+' matching service update'+(alerts.length===1?'':'s')+'. Your chosen journey has not changed.':'No matching service updates returned. This does not confirm that every service is running normally.';
  if(alerts.length){
    const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Service updates for your remaining journey';details.append(summary);
    for(const alert of alerts){const article=document.createElement('article'),h=document.createElement('h3'),p=document.createElement('p');article.className='alert-item';h.textContent=alert.title;p.textContent=alert.description;article.append(h,p);details.append(article);}
    $('journey-alert-results').append(details);
  }
  journeyAlertTimer=setTimeout(()=>{if(sequence===journeyAlertSequence){$('journey-alert-results').replaceChildren();$('journey-alert-status').textContent='Service updates have expired. Check again for current information.';}},Math.max(0,(feed.updated+180-Date.now()/1000)*1000));
};
$('next-leg').onclick=()=>{if(state.legIndex===state.selectedJourney.legs.length-1){showScreen('arrived');return;}state.legIndex++;renderFollow();$('flow-title').focus();};
$('previous-leg').onclick=()=>{if(state.legIndex>0)state.legIndex--;renderFollow();$('flow-title').focus();};
function renderSavedPlaces(){
  const saved=state.preferences.journeys.some(j=>j.saved&&j.from.id===state.from?.id&&j.to.id===state.to?.id);
  $('save-places').hidden=state.intent==='nearby';$('save-places-help').hidden=state.intent==='nearby';
  translated('save-places',saved?'save.saved':'save.places');$('save-places').setAttribute('aria-pressed',String(saved));
}
$('save-places').onclick=async()=>{
  const {from,to}=state;if(!from||!to)return;
  let journey=state.preferences.journeys.find(j=>j.from.id===from.id&&j.to.id===to.id);
  if(!journey){journey={from,to,count:0,hours:Array(24).fill(0),days:Array(7).fill(0),last:Date.now(),saved:false};state.preferences.journeys.push(journey);}
  journey.saved=!journey.saved;
  if(!journey.saved){journey.savedRoutes=null;state.savedPreference=null;}
  const saved=await persist();renderSavedPlaces();if(saved)translated('announcement',journey.saved?'save.done':'save.removed');
};
$('prefer-services').onclick=async()=>{
  const {from,to}=state.lastSearch;let journey=state.preferences.journeys.find(j=>j.from.id===from.id&&j.to.id===to.id);
  if(!journey){journey={from,to,count:0,hours:Array(24).fill(0),days:Array(7).fill(0),last:Date.now(),saved:false};state.preferences.journeys.push(journey);}
  const routes=journeyRoutes(state.selectedJourney);
  const wasSaved=journey.saved&&sameRoutes(journey.savedRoutes,routes);
  journey.saved=true;journey.savedRoutes=wasSaved?null:routes;
  state.savedPreference=null;for(const option of state.journeys)delete option.preferred;
  const saved=await persist();renderJourneys();renderFollow();if(saved)translated('announcement',wasSaved?'service.removed':'service.saved',()=>({services:routes.length?routes.map(r=>`${language.text('mode.'+r.mode+'Title')} ${r.route}`).join(' → '):language.text('journey.walkRoll')}));
};
$('sort').onchange=renderJourneys;
$('use-any-route').onclick=()=>{state.savedPreference=null;searchJourney();};
async function refreshNearby({liveRequested=false}={}){
  clearTimeout(nearbyLiveTimer);
  if(!state.location){$('departures').innerHTML=`<div class="empty-state"><h3>${message('nearby.start')}</h3><p>${message('nearby.startHelp')}</p></div>`;return;}
  const sequence=++state.nearbySequence,location={...state.location};
  if($('direct-only').checked&&!state.to){$('departures').innerHTML=`<div class="error-state">${message('nearby.chooseDestination')}</div>`;return;}
  $('refresh').disabled=true;$('nearby-live').disabled=true;$('nearby-live-status').textContent=liveRequested?'Checking current AT predictions…':'';translated('nearby-context','nearby.context',{place:state.locationLabel});
  $('departures').innerHTML=`<div class="loading">${message('nearby.loading')}</div>`;
  try{
    // Scheduled results render immediately; live predictions are a progressive enhancement.
    const args={...location,to:$('direct-only').checked?state.to:null,mode:$('nearby-mode').value,now:aucklandNow(),feed:{available:false},profile:accessProfile()};
    const data=await ask('nearby',args);if(sequence!==state.nearbySequence)return;renderDepartures(data);
    if(!liveRequested)return;
    const fresh=await liveClient.read('predictions',{requested:true});if(sequence!==state.nearbySequence || state.screen!=='nearby')return;
    $('nearby-live-status').textContent=fresh.available?'Current feed checked. Only matched services show live predictions.':'Current predictions unavailable. Scheduled departures are still available.';
    if(fresh.available){const updated=await ask('nearby',{...args,feed:fresh,now:aucklandNow()});if(sequence===state.nearbySequence){
      renderDepartures(updated);
      if(Number.isFinite(updated.liveExpires))nearbyLiveTimer=setTimeout(async()=>{
        if(sequence!==state.nearbySequence||state.screen!=='nearby')return;
        await refreshNearby();
        if(state.nearbySequence===sequence+1&&state.screen==='nearby')$('nearby-live-status').textContent='Live predictions have expired. Showing scheduled departures.';
      },Math.max(0,(updated.liveExpires-Date.now()/1000)*1000));
    }}
  }catch(error){if(sequence===state.nearbySequence)$('departures').innerHTML=`<div class="error-state">${errorPhraseKey(error)?message(errorPhraseKey(error)):`<span lang="en-NZ">${escape(error.message)}</span>`}</div>`;}
  finally{if(sequence===state.nearbySequence){$('refresh').disabled=false;$('nearby-live').disabled=false;}}
}
function renderDepartures(data){
  state.departureData=data;$('more-stops').hidden=data.stops.length<=3;translated('more-stops',state.showAllStops?'nearby.fewer':'nearby.more');
  $('nearby-note').innerHTML=[message('nearby.checked',{time:clock(aucklandNow().seconds)}),message(data.live?'nearby.liveNote':'nearby.scheduledNote'),message('nearby.refreshNote'),data.directOnly?message('nearby.directNote'):'',message(data.walkingSource==='mapped'?'nearby.mapped':'nearby.estimated'),message('nearby.buffer')].filter(Boolean).join(' ');
  if(!data.stops.length){$('departures').innerHTML=`<div class="empty-state"><h3>${message(data.directOnly?'nearby.noneDirect':'nearby.none')}</h3><p>${message(data.directOnly?'nearby.tryDirect':'nearby.try')}<br>${message('nearby.window')}</p></div>`;return;}
  $('departures').innerHTML=data.stops.slice(0,state.showAllStops?8:3).map((s,i)=>`<article class="stop-card"><div class="stop-header"><div>${i===0?`<span class="context-tag">${message('nearby.first')}</span>`:''}<h3>${placeDetail(s.stop)}</h3><p>${message('nearby.distance',{code:s.stop.code||s.stop.id,metres:s.distance})}</p></div><span class="walk-time">${message('nearby.walk',{minutes:s.walk})}</span></div>${s.departures.slice(0,3).map(d=>`<div class="departure-row ${d.tight?'tight':''}">${routeLink(escape(d.route),{tripId:d.trip},`route-badge detail-link ${d.mode}`)}<div class="departure-info"><strong>${escape(d.headsign||'See route destination')}</strong><small>${message('mode.'+d.mode+'Title')}${d.tight?message('nearby.tight'):''}</small></div><div class="departure-time"><strong>${d.minutes} <small>${message('journey.minuteUnit')}</small></strong><small>${message(d.live?'nearby.live':'nearby.scheduled')}</small></div></div>`).join('')}</article>`).join('');
}
$('refresh').onclick=()=>refreshNearby();$('nearby-live').onclick=()=>refreshNearby({liveRequested:true});$('nearby-mode').onchange=refreshNearby;$('direct-only').onchange=refreshNearby;
$('location').onclick=()=>{if(!navigator.geolocation){translated('form-error','location.unavailable');return;}$('location').disabled=true;translated('location','location.finding');navigator.geolocation.getCurrentPosition(position=>{setPlace('origin',{id:`location:${position.coords.latitude.toFixed(5)},${position.coords.longitude.toFixed(5)}`,name:'Current location',lat:position.coords.latitude,lon:position.coords.longitude,placeType:'address'});state.locationLabel='your location';$('location').disabled=false;translated('location','location.use');translated('announcement','location.selected');},()=>{$('location').disabled=false;translated('location','location.use');translated('form-error','location.failed');},{enableHighAccuracy:false,timeout:12000,maximumAge:60000});};
$('try-britomart').onclick=async()=>{try{const matches=await ask('search',{query:'Waitemata'});const alternatives=matches.length?matches:await ask('search',{query:'Britomart'});const stop=alternatives.find(s=>s.kind===1)||alternatives[0];if(!stop)throw new Error('Try searching for Waitematā or Britomart in the origin field.');setPlace('origin',stop);review();}catch(error){showError('form-error',error);}};
$('settings-open').onclick=()=>$('settings').showModal();document.querySelectorAll('.close-dialog').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$('learning-enabled').onchange=async()=>{state.preferences.learning=$('learning-enabled').checked;await persist();$('learning-enabled').checked=state.preferences.learning;};
$('clear-history').onclick=async()=>{state.preferences.journeys=[];if(await persist())translated('storage-message','learning.cleared');if(state.lastSearch)renderJourneys();if(state.selectedJourney)renderFollow();};
$('alerts-open').onclick=async()=>{$('alerts').showModal();$('alerts-content').innerHTML=`<div class="loading">${message('alerts.loading')}</div>`;try{const data=await liveClient.read('alerts',{requested:true});if(!data.available)throw new Error();$('alerts-content').innerHTML=data.available?(data.alerts.length?data.alerts.map(a=>`<article class="alert-item" lang="en-NZ"><h3>${escape(a.title)}</h3><p>${escape(a.description)}</p></article>`).join(''):`<p>${message('alerts.none')}</p>`):`<p><span lang="en-NZ">${escape(data.message)}</span> ${message('alerts.website')}</p>`;}catch{$('alerts-content').innerHTML=`<p>${message('alerts.offline')}</p>`;}};
let installPrompt;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('install').hidden=false;});
$('install').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;$('install').hidden=true;}};
function updateStatus(){
  translated('data-status',state.ready?(state.stored&&state.shellReady&&state.streetsStored?(navigator.onLine?'status.ready':'status.offline'):state.streetsReady?'status.session':'status.streetSearch'):'status.loading');
}
function ready(result){state.ready=true;state.stored=result.stored;state.metadata=result.metadata;updateStatus();const end=result.metadata.feed_end_date||'';const expiry=end?`${end.slice(6,8)}/${end.slice(4,6)}/${end.slice(0,4)}`:'not specified';$('offline-info').innerHTML=[message(end?'status.overview':'status.unknownExpiry',{stops:result.stops.toLocaleString(),expiry}),message(result.stored?'status.stored':'status.notStored'),message('status.localRouting')].join(' ');}
$('update-timetable').onclick=async()=>{$('update-timetable').disabled=true;translated('offline-info','status.refresh');try{ready(await ask('update'));await loadStreets(true);}catch(error){showError('offline-info',error);}finally{$('update-timetable').disabled=false;}};
window.addEventListener('online',()=>{updateStatus();if(state.location)refreshNearby();});window.addEventListener('offline',()=>{liveClient.cancel();updateStatus();if(state.location)refreshNearby();});
// Departure updates are requested explicitly; avoid moving lists while people read.
history.replaceState({alongScreen:'destination',depth:0,intent:'plan'},'');showScreen('destination',{focus:false,historyEntry:false});
translated('location','location.use');translated('preparation-hint','status.preparing');applyLanguage();renderUsual();setNow();$('today').textContent=new Intl.DateTimeFormat('en-NZ',{timeZone:'Pacific/Auckland',weekday:'long',day:'numeric',month:'short'}).format(new Date());
if('serviceWorker' in navigator){navigator.serviceWorker.register(new URL('./sw.js',import.meta.url),{type:'module',updateViaCache:'none'}).then(registration=>{setupUpdates(registration,language);return navigator.serviceWorker.ready;}).then(()=>{state.shellReady=true;updateStatus();}).catch(()=>{});}
ask('init').then(async result=>{ready(result);navigator.storage?.persist?.().catch(()=>{});await loadStreets();}).catch(error=>{translated('data-status','status.unavailable');showError('form-error',error);showError('offline-info',error);});

setupFeedback(language,()=>({version:document.querySelector('#settings').textContent.match(/App version (\d+)/)?.[1],language:language.language,screen:state.screen}));
