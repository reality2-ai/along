import {setupUpdates} from './updates.js';
import {aucklandNow} from './planner.js';
import {readPreferences,writePreferences,recordJourney,suggestions} from './preferences.js';
const $=id=>document.getElementById(id);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock=seconds=>{const s=((seconds%86400)+86400)%86400;return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor(s%3600/60)).padStart(2,'0')}${seconds>=86400?' +1 day':''}`;};
const minutes=seconds=>Math.ceil(seconds/60);
const state={from:null,to:null,location:null,locationLabel:'',journeys:[],preferences:readPreferences(),ready:false,stored:false,shellReady:false,streetsReady:false,streetsStored:false,showAllStops:false,nearbySequence:0,searchSequence:0,lastSearch:null,screen:'destination',intent:'plan',selectedJourney:null,legIndex:0};
const worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
let requestId=0;
const pending=new Map();
worker.onmessage=({data})=>{const promise=pending.get(data.id);if(!promise)return;pending.delete(data.id);data.error?promise.reject(new Error(data.error)):promise.resolve(data.result);};
worker.onerror=()=>{for(const p of pending.values())p.reject(new Error('The route engine could not start. Reload Along to try again.'));pending.clear();};
function ask(type,args={}){return new Promise((resolve,reject)=>{const id=++requestId;pending.set(id,{resolve,reject});worker.postMessage({id,type,args});});}
function accessProfile(){return {pace:Number($('walking-pace').value),avoidSteps:$('avoid-steps').checked,confirmedAccess:$('confirmed-access').checked};}
function updatePreferenceSummary(){
  const selected=[...document.querySelectorAll('.modes input:checked')].map(i=>i.value);
  $('preference-summary').textContent=`Depart ${$('time').value||'now'} · ${selected.length===3?'Bus, train & ferry':selected.join(', ')||'Choose transport'}${$('avoid-steps').checked?' · Avoid barriers':''}${$('confirmed-access').checked?' · Confirmed access only':''}${$('walking-pace').value!=='1.25'?' · More walking time':''}`;
  $('active-preferences').textContent=$('preference-summary').textContent;
}
function walkingDirections(leg){
  if(!leg.directions)return '<p>Station access is estimated. Check the entrance, lift and platform signs.</p>';
  return `<details class="walk-directions"><summary>Walking directions · ${leg.directions.metres} m</summary><ol>${leg.directions.steps.map(s=>`<li>${escape(s.name)} · ${s.metres} m${s.estimated?' (access link estimated)':''}</li>`).join('')}</ol><p>Follow local crossing and access signs. Unmapped barriers and changes may affect this path.</p></details>`;
}
async function loadStreets(refresh=false){
  $('address-status').hidden=false;$('address-status').textContent='Preparing offline addresses and walking paths. This first download is about 24 MB.';
  try{const result=await ask('streets',{refresh});state.streetsReady=true;state.streetsStored=result.stored;updateStatus();$('address-status').textContent=result.stored?'Street addresses and walking paths are ready offline.':'Street search is ready for this session; device storage was unavailable.';$('preparation-hint').hidden=true;$('offline-info').textContent+=` ${result.addresses.toLocaleString()} addresses and the Auckland walking map are ${result.stored?'stored on this device':'available for this session'}.`;}
  catch(error){$('address-status').textContent=error.message;$('preparation-hint').textContent='Address search is unavailable. You can still choose a station or stop.';updateStatus();}
}
const mobility=state.preferences.mobility||{};
if([300,600,900,1200].includes(mobility.maxWalk))$('max-walk').value=mobility.maxWalk;
if([0.8,1,1.25].includes(mobility.pace))$('walking-pace').value=mobility.pace;
$('avoid-steps').checked=!!mobility.avoidSteps;$('confirmed-access').checked=!!mobility.confirmedAccess;
for(const id of ['max-walk','walking-pace','avoid-steps','confirmed-access'])$(id).addEventListener('change',()=>{state.preferences.mobility={...accessProfile(),maxWalk:Number($('max-walk').value)};persist();updatePreferenceSummary();if(state.location)refreshNearby();});
for(const input of document.querySelectorAll('#date,#time,.modes input'))input.addEventListener('change',updatePreferenceSummary);
$('leave-now').onclick=setNow;
$('more-stops').onclick=()=>{state.showAllStops=!state.showAllStops;if(state.departureData)renderDepartures(state.departureData);};
const context=()=>{const at=aucklandNow();return {hour:Number(at.time.slice(0,2)),day:new Date(at.date+'T12:00:00Z').getUTCDay(),timestamp:Date.now()};};
function persist(){const saved=writePreferences(state.preferences);$('storage-message').textContent=saved?'':'This browser could not save your preferences. They will last for this session only.';renderUsual();}
function renderUsual(){
  const usual=suggestions(state.preferences,context());
  $('usual-journeys').innerHTML=usual.length?usual.map((j,i)=>`<button type="button" class="usual-card" data-usual="${i}"><span class="usual-icon">${j.saved?'☆':'↗'}</span><span><strong>${escape(j.to.name)}</strong><small>From ${escape(j.from.name)}</small><small>${j.saved?'Saved journey':`${j.count} searches · one tap to plan`}</small></span></button>`).join(''):`<div class="usual-placeholder"><span class="usual-icon">↗</span><div><strong>${state.preferences.learning?'Your routine starts with a journey.':'Somewhere different? You’re in the right place.'}</strong>${state.preferences.learning?'Search a route a few times, or save one, and it will appear here.':'Learning is paused. You can still save journeys yourself.'}</div></div>`;
  document.querySelectorAll('[data-usual]').forEach(button=>button.onclick=()=>{state.intent='plan';const trip=usual[Number(button.dataset.usual)];setPlace('origin',trip.from);setPlace('destination',trip.to);setNow();searchJourney();});
  document.querySelector('.usual-section').hidden=!usual.length;
  $('learning-enabled').checked=state.preferences.learning;
  $('learning-note').textContent=state.preferences.learning?'Your searches help your usual journeys find their way here. Stored only on this device.':'Journey learning is paused. Saved routes stay available, and every new journey is yours to choose.';
}
function setNow(){const now=aucklandNow();$('date').value=now.date;$('time').value=now.time;updatePreferenceSummary();}
function setPlace(field,stop){state[field==='origin'?'from':'to']=stop;$(field).value=stop?.name||'';$(field+'-options').hidden=true;$(field).setAttribute('aria-expanded','false');if(field==='origin'){state.location=null;if(stop){state.location={lat:stop.lat,lon:stop.lon};state.locationLabel=stop.name;}}}
let navDepth=0;
function showScreen(screen,{focus=true,historyEntry=true}={}){
  if(screen!=='options'&&state.screen==='options'){state.searchSequence++;$('find').disabled=false;}
  state.screen=screen;
  for(const section of document.querySelectorAll('[data-screen]'))section.hidden=section.dataset.screen!==screen;
  $('journey-form').hidden=!['destination','origin','review'].includes(screen);
  const titles={destination:'Where would you like to go?',origin:'Where are you travelling from?',review:state.intent==='nearby'?'Review departure preferences':'Review your journey',options:'Choose your journey',follow:'Your next step',arrived:'You’re there.',nearby:'Your next ride nearby'};
  $('flow-title').textContent=titles[screen];
  $('flow-progress').textContent=({destination:'Plan a journey',origin:'Choose your starting place',review:'Time and travel needs',options:'Choose a route',follow:'Follow your journey',arrived:'Journey complete',nearby:'Compare nearby stops'})[screen];
  $('flow-context').textContent=screen==='origin'&&state.to&&state.intent==='plan'?`Destination already selected: ${state.to.name}`:['options','follow','arrived'].includes(screen)&&state.lastSearch?`${state.lastSearch.from.name} → ${state.lastSearch.to.name}`:'';
  $('new-journey').hidden=screen==='destination';$('flow-back').hidden=screen==='destination';
  $('review-origin').textContent=state.from?.name||'Choose a starting place';$('review-destination').textContent=state.to?.name||'';
  $('review-destination-row').hidden=state.intent==='nearby';$('swap').hidden=state.intent==='nearby';
  $('origin-next').textContent=state.intent==='nearby'?'Review departure preferences →':'Review journey →';
  $('find').textContent=state.intent==='nearby'?'Show nearby departures →':'Find my way →';
  $('try-britomart').hidden=state.intent!=='nearby';
  $('journey-notes').hidden=!['options','follow'].includes(screen);
  $('form-error').textContent='';
  for(const field of ['origin','destination']){$(field+'-options').hidden=true;$(field).setAttribute('aria-expanded','false');$(field).removeAttribute('aria-activedescendant');}
  if(historyEntry){navDepth++;history.pushState({alongScreen:screen,depth:navDepth,intent:state.intent},'');}
  if(focus)$('flow-title').focus();
}
window.addEventListener('popstate',event=>{
  if(event.state?.alongDetail){displayDetail(event.state.alongDetail);return;}
  if($('information').open){const target=detailViews.get(activeDetail)?.returnFocus;$('information').close();if(contextMap){contextMap.remove();contextMap=null;}activeDetail=null;if(target?.isConnected)target.focus();return;}

  navDepth=event.state?.depth||0;state.intent=event.state?.intent||'plan';
  let screen=event.state?.alongScreen||'destination';
  if(['follow','arrived'].includes(screen)&&!state.selectedJourney)screen='options';
  showScreen(screen,{historyEntry:false});
});
$('flow-back').onclick=()=>{if(navDepth)history.back();else showScreen('destination');};
function startNew(){state.searchSequence++;state.nearbySequence++;$('find').disabled=false;state.intent='plan';setPlace('origin',null);setPlace('destination',null);state.journeys=[];state.lastSearch=null;state.selectedJourney=null;$('direct-only').checked=false;setNow();showScreen('destination');}
function review(){showScreen('review');}
function nearby(){showScreen('nearby');refreshNearby();}
$('nearby-start').onclick=()=>{state.intent='nearby';showScreen('origin');};
$('edit-origin').onclick=()=>showScreen('origin');$('edit-destination').onclick=()=>showScreen('destination');
$('change-search').onclick=review;$('nearby-edit').onclick=()=>{state.intent='nearby';review();};
$('nearby-from-options').onclick=()=>{state.intent='nearby';nearby();};
$('nearby-plan').onclick=()=>{state.intent='plan';showScreen('destination');};
$('another-journey').onclick=startNew;
$('return-journey').onclick=()=>{const last=state.lastSearch;state.intent='plan';setPlace('origin',last.to);setPlace('destination',last.from);setNow();review();};
for(const field of ['origin','destination']){
  const input=$(field),list=$(field+'-options');let timer,sequence=0,items=[],active=-1;
  const close=()=>{list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');};
  const choose=index=>{if(!items[index])return;sequence++;setPlace(field,items[index]);close();};
  input.addEventListener('input',()=>{state[field==='origin'?'from':'to']=null;if(field==='origin'){state.location=null;state.nearbySequence++;}const current=++sequence;clearTimeout(timer);timer=setTimeout(async()=>{
    if(input.value.trim().length<2){close();return;}
    try{const result=await ask('search',{query:input.value});if(current!==sequence)return;items=result;active=-1;
      list.innerHTML=items.length?items.map((s,i)=>`<li role="option" aria-selected="false" id="${field}-option-${i}" data-index="${i}">${escape(s.name)}<small>${s.placeType==='address'?'Street address':s.kind===1?'Station':`Stop ${escape(s.code||s.id)}`}</small></li>`).join(''):'<li role="option" aria-disabled="true">No matching place. Try the street number, street name and suburb.</li>';
      list.hidden=false;input.setAttribute('aria-expanded','true');
      list.querySelectorAll('[data-index]').forEach(item=>{item.addEventListener('pointerdown',event=>event.preventDefault());item.addEventListener('click',()=>choose(Number(item.dataset.index)));});
    }catch(error){$('form-error').textContent=error.message;}
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
    if(!state.to){$('form-error').textContent='Choose a destination from the suggestions.';$('destination').focus();return;}
    state.intent='plan';showScreen(state.from?'review':'origin');
  }else if(state.screen==='origin'){
    if(!state.from){$('form-error').textContent='Choose a starting place from the suggestions, or use your location.';$('origin').focus();return;}
    review();
  }else if(state.screen==='review'){
    if(state.intent==='nearby')nearby();else searchJourney();
  }
};
async function searchJourney(){
  const from=state.from,to=state.to;$('form-error').textContent='';
  if(!from||!to){$('form-error').textContent='Choose both places from the suggestions.';return;}
  const modes=[...document.querySelectorAll('.modes input:checked')].map(i=>i.value);
  state.lastSearch={from,to,date:$('date').value,time:$('time').value};
  showScreen('options');
  const date=$('date').value,time=$('time').value,sequence=++state.searchSequence;
 $('find').disabled=true;$('journeys').innerHTML='<div class="loading">Finding your way through Auckland…</div>';
  try{
    const journeys=await ask('plan',{from,to,date,time,modes,maxWalk:Number($('max-walk').value),profile:accessProfile()});if(sequence!==state.searchSequence)return;
    state.journeys=journeys;state.lastSearch={from,to,date,time};$('journey-title').textContent=journeys.length?`${journeys.length} way${journeys.length===1?'':'s'} to get there`:'No journey found in this window';
    if(journeys.length){state.preferences=recordJourney(state.preferences,from,to,{hour:Number(time.slice(0,2)),day:new Date(date+'T12:00:00Z').getUTCDay(),timestamp:Date.now()});persist();}renderJourneys();$('announcement').textContent=journeys.length?`${journeys.length} journey options. Earliest arrival ${clock(journeys[0].arrival)}.`:'No journey found with these preferences.';$('journey-title').focus();
  }catch(error){if(sequence===state.searchSequence){showScreen('review');$('form-error').textContent=error.message;$('form-error').focus();}}
  finally{if(sequence===state.searchSequence)$('find').disabled=false;}
}
// Detail layers keep the underlying task, scroll position and explicit journey progress.
const detailViews=new Map();let detailId=0,activeDetail=null;
function detailLink(label,title,body,className='detail-link'){
  const id=++detailId;detailViews.set(id,{title,body});
  return `<button type="button" class="${className}" data-detail="${id}" aria-haspopup="dialog">${label}</button>`;
}
function placeDetail(place){
  const label=escape(place.name),id=detailId+1;
  const link=detailLink(label,place.name,async()=>{
    const now=explorationTime(),departures=place.placeType==='address'?[]:await ask('stopDetails',{id:place.id,now});
    return `<p>${place.placeType==='address'?'Street address':'Station or stop'}${place.code?' · Stop '+escape(place.code):''}</p>${mapMarkup()}<p>Accessibility at this location is not verified. Check entrances, crossings and any lifts before travelling.</p>${place.placeType==='address'?'':`<h3>Departures from ${clock(now.seconds)} · ${escape(now.date)}</h3><p>Scheduled, next two hours. Choose a route to explore its full path.</p>${departures.length?departures.map(d=>`<p>${clock(d.departure)} · ${routeLink(escape(d.route),{routeId:d.routeId,tripId:d.trip})} · ${escape(d.headsign)}</p>`).join(''):'<p>No scheduled departures in this window.</p>'}`}`;
  });detailViews.get(id).mount=()=>mountMap(null,[place]);return link;
}
function legDetail(leg,label,className){
  if(leg.mode!=='walk')return routeLink(label,{routeId:leg.routeId,tripId:leg.trip},className);
  return detailLink(label,leg.mode==='walk'?'Walking connection':`${leg.mode[0].toUpperCase()+leg.mode.slice(1)} ${leg.route}`,()=>`${legMarkup(leg)}<p>${leg.mode==='walk'?'Walking duration and access links are estimates.':'Times are scheduled, not live predictions.'}</p>`,className);
}
async function displayDetail(id){
  const view=detailViews.get(id);if(!view)return;
  if(contextMap){contextMap.remove();contextMap=null;}
  activeDetail=id;$('detail-title').textContent=view.title;$('detail-body').innerHTML='<p role="status">Loading details…</p>';
  if(!$('information').open)$('information').showModal();
  $('information').scrollTop=0;$('detail-title').focus();
  try{const markup=view.markup??await view.body();view.markup=markup;if(activeDetail!==id||!$('information').open)return;$('detail-body').innerHTML=markup;view.mount?.();mountVariant(view);$('detail-body').querySelectorAll('details').forEach((d,i)=>{if(view.openDetails)d.open=!!view.openDetails[i];});if(view.restoreDetail)$('detail-body').querySelector(`[data-detail="${view.restoreDetail}"]`)?.focus();$('information').scrollTop=view.scroll||0;}
  catch(error){if(activeDetail===id)$('detail-body').textContent=error.message;}
}
function openInformation(button){
  if(!button)return;
  const id=Number(button.dataset.detail),view=detailViews.get(id);if(!view)return;
  if(activeDetail){const parent=detailViews.get(activeDetail);parent.scroll=$('information').scrollTop;parent.openDetails=[...$('detail-body').querySelectorAll('details')].map(d=>d.open);parent.restoreDetail=id;}view.returnFocus=button;history.pushState({...history.state,alongDetail:id},'');displayDetail(id);
}
document.addEventListener('click',event=>openInformation(event.target.closest('[data-detail]')));
$('detail-back').onclick=()=>history.back();
$('information').addEventListener('cancel',event=>{event.preventDefault();history.back();});
function explorationTime(){return ['options','follow','arrived'].includes(state.screen)&&state.lastSearch?{date:state.lastSearch.date,time:state.lastSearch.time,seconds:Number(state.lastSearch.time.slice(0,2))*3600+Number(state.lastSearch.time.slice(3))*60}:aucklandNow();}
function mapMarkup(){return '<div class="context-map-frame"><div id="context-map" class="context-map" role="region" aria-label="Map. Use arrow keys to pan and plus or minus to zoom." tabindex="0"></div><button type="button" class="map-load-button" id="map-streets"><strong>Show street map</strong><span>Needs internet · OpenStreetMap</span></button></div><p class="field-help">Street tiles load from OpenStreetMap only when requested. Route lines and stop locations use downloaded AT data.</p>';}
let contextMap;
function mountMap(points,stops){
  if(!$('context-map')||!globalThis.L)return;
  contextMap=L.map('context-map',{scrollWheelZoom:false,zoomAnimation:false,fadeAnimation:false,markerZoomAnimation:false});
  contextMap.attributionControl.addAttribution('Route and stops: Auckland Transport');
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
    if(!data.variants.length)return `<p>${escape(data.number)} · ${escape(data.name)}</p><p>No services in the downloaded timetable for ${escape(data.date)}.</p>`;
    const variantLink=(v,i)=>{const id=detailId+1,link=detailLink(`${escape(v.headsign||data.name)} · ${v.stops.length} stops · from ${escape(v.stops[0].stop.name)}`,`${data.number} · ${v.headsign||data.name}`,()=>routeVariantMarkup(data,v), 'detail-link route-variant');Object.assign(detailViews.get(id),{variant:v,routeData:data});return link;};
    return `<p>${escape(data.mode)} ${escape(data.number)} · ${escape(data.name)}</p><p>Scheduled services for ${escape(data.date)}. Choose a direction or branch to see its full path and times.</p>${variantLink(data.variants[0],0)}${data.variants.length>1?`<details><summary>Other directions and branches (${data.variants.length-1})</summary>${data.variants.slice(1).map(variantLink).join('')}</details>`:''}`;
  },className);
}
function routeVariantMarkup(data,v){
  const run=v.runs.find(r=>r.trip===v.selectedTrip)||v.runs[0];
  return `<p>${escape(data.date)} · Scheduled times. This is a service route, not a live vehicle position.</p>${mapMarkup()}<p>${v.shape?'Published AT route geometry.':'Route geometry unavailable; the map shows stop locations only.'}</p><label class="preference-field">Service departing its first stop<select id="route-run">${v.runs.map(r=>`<option value="${escape(r.trip)}" ${r.trip===run.trip?'selected':''}>${clock(r.departure)}</option>`).join('')}</select></label><label class="preference-field">Find a street or stop on this direction<input id="route-stop-filter" type="search" placeholder="For example, Symonds"></label><p class="field-help">Matches stop names. A street with no matching stop may still be on the route: check the map. Other branches can take different paths.</p><p id="route-match-status" role="status"></p><ol class="route-stop-list">${run.stops.map((s,i)=>`<li data-stop-name="${escape(s.stop.name.toLowerCase())}"><span class="stop-schedule">${clock(s.time)}</span> ${placeDetail(s.stop)}${i===run.stops.length-1?' · Last stop':!s.pickup?' · No regular pickup':''}</li>`).join('')}</ol>`;
}
function mountVariant(view){
  const v=view.variant;if(!v)return;
  mountMap(v.shape,v.stops.map(s=>s.stop));
  $('route-run').onchange=()=>{v.selectedTrip=$('route-run').value;view.markup=routeVariantMarkup(view.routeData,v);displayDetail(activeDetail);$('route-run')?.focus();};
  const filter=()=>{const q=$('route-stop-filter').value.toLowerCase().trim();let count=0;document.querySelectorAll('.route-stop-list li').forEach(li=>{li.hidden=!li.dataset.stopName.includes(q);if(!li.hidden)count++;});$('route-match-status').textContent=q?`${count} matching stops in this direction`:'';view.filter=q;};
  $('route-stop-filter').value=view.filter||'';$('route-stop-filter').oninput=filter;filter();
}
$('browse-routes').onclick=()=>{
  const label='Explore a route',button=$('browse-routes'),id=++detailId;
  detailViews.set(id,{title:label,returnFocus:button,body:()=>'<label class="preference-field">Route number or name<input id="route-search" type="search" placeholder="For example, 70 or Western"></label><div id="route-search-results" aria-live="polite"></div>',mount:()=>{
    const view=detailViews.get(id);$('route-search').value=view.query||'';$('route-search-results').innerHTML=view.results||'';let request=0;$('route-search').oninput=async()=>{const sequence=++request,query=$('route-search').value;view.query=query;const results=await ask('routes',{query});if(sequence!==request||!$('route-search-results'))return;view.results=$('route-search-results').innerHTML=results.length?results.map(r=>routeLink(`${escape(r.number)} · ${escape(r.name)}`,{routeId:r.id},'detail-link route-variant')).join(''):query?'<p>No matching routes.</p>':'';};
  }});history.pushState({...history.state,alongDetail:id},'');displayDetail(id);
};

function legMarkup(l){
  return `<div class="leg"><strong>${clock(l.departure)}</strong><div>${l.mode==='walk'?`Walk to ${escape(l.to.name)}`:` ${routeLink(`${l.mode} ${escape(l.route)}`,{routeId:l.routeId,tripId:l.trip},`route-badge detail-link ${l.mode}`)} ${escape(l.headsign||l.to.name)}`}<p>From ${placeDetail(l.from)}${l.from.code?' · '+escape(l.from.code):''}</p><p>To ${placeDetail(l.to)} · ${clock(l.arrival)} · ${minutes(l.arrival-l.departure)} min</p>${l.mode==='walk'?walkingDirections(l):''}</div></div>`;
}
function renderJourneys(){
  const sort=$('sort').value,journeys=[...state.journeys].sort((a,b)=>a[sort]-b[sort]||a.arrival-b.arrival);state.displayJourneys=journeys;
  $('sort').hidden=journeys.length<2;
  if(!journeys.length){$('journeys').innerHTML='<div class="empty-state"><h3>Let’s try another option.</h3><p>No route was found within these preferences.</p><button class="primary-button" id="adjust-journey">Adjust journey preferences →</button></div>';$('adjust-journey').onclick=()=>{review();$('journey-preferences').open=true;$('journey-preferences').querySelector('summary').focus();};return;}
  const card=(j,i)=>`<article class="journey-card"><div class="journey-summary"><span class="context-tag">${i===0?(sort==='arrival'?'Earliest arrival':sort==='transfers'?'Fewest changes':'Least walking'):'Another option'}</span><div class="journey-top"><div class="journey-times">${clock(j.departure)} → ${clock(j.arrival)}</div><div class="journey-duration">${minutes(j.duration)} <small>min</small></div></div><p class="journey-meta">${j.walkOnly?'Walk or roll':j.transfers===0?'No changes':`${j.transfers} change${j.transfers>1?'s':''}`} · ${minutes(j.walking)} min walking / rolling</p><div class="journey-path">${j.legs.map(l=>legDetail(l,l.mode==='walk'?'Walk':`${l.mode==='bus'?'Bus':l.mode==='train'?'Train':'Ferry'} ${escape(l.route)}`,l.mode==='walk'?'detail-link':`route-badge detail-link ${l.mode}`)).join('<span class="path-arrow">›</span>')}</div><button class="${i===0?'primary-button':'secondary-button'}" data-follow="${i}">Use this journey →</button></div></article>`;
  $('journeys').innerHTML=card(journeys[0],0)+(journeys.length>1?`<details class="alternatives"><summary>See ${journeys.length-1} other option${journeys.length>2?'s':''}</summary>${journeys.slice(1).map((j,i)=>card(j,i+1)).join('')}</details>`:'');
  document.querySelectorAll('[data-follow]').forEach(button=>button.onclick=()=>{state.selectedJourney=journeys[Number(button.dataset.follow)];state.legIndex=0;$('full-itinerary').open=false;renderFollow();showScreen('follow');});
}
function renderFollow(){
  const journey=state.selectedJourney,leg=journey.legs[state.legIndex];
  $('step-count').textContent=`Step ${state.legIndex+1} of ${journey.legs.length}`;
  $('current-step').innerHTML=legMarkup(leg);
  $('itinerary-legs').innerHTML=journey.legs.map(legMarkup).join('');
  $('previous-leg').hidden=state.legIndex===0;
  $('next-leg').textContent=state.legIndex===journey.legs.length-1?'I’ve arrived':'Next step →';
  const saved=state.preferences.journeys.some(j=>j.saved&&j.from.id===state.lastSearch.from.id&&j.to.id===state.lastSearch.to.id);
  $('save-journey').textContent=saved?'★ Saved journey':'☆ Save this journey';$('save-journey').setAttribute('aria-pressed',String(saved));
}
$('next-leg').onclick=()=>{if(state.legIndex===state.selectedJourney.legs.length-1){showScreen('arrived');return;}state.legIndex++;renderFollow();$('flow-title').focus();};
$('previous-leg').onclick=()=>{if(state.legIndex>0)state.legIndex--;renderFollow();$('flow-title').focus();};
$('save-journey').onclick=()=>{
  const {from,to}=state.lastSearch;let journey=state.preferences.journeys.find(j=>j.from.id===from.id&&j.to.id===to.id);
  if(!journey){journey={from,to,count:0,hours:Array(24).fill(0),days:Array(7).fill(0),last:Date.now(),saved:false};state.preferences.journeys.push(journey);}
  journey.saved=!journey.saved;persist();$('save-journey').textContent=journey.saved?'★ Saved journey':'☆ Save this journey';$('save-journey').setAttribute('aria-pressed',String(journey.saved));
};
$('sort').onchange=renderJourneys;
let predictions={available:false},predictionsAt=0;
async function getPredictions(){if(Date.now()-predictionsAt<60000)return predictions;predictionsAt=Date.now();try{const response=await fetch(new URL('./api/predictions',import.meta.url),{signal:AbortSignal.timeout(5000)});predictions=response.ok?await response.json():{available:false};}catch{predictions={available:false};}return predictions;}
async function refreshNearby(){
  if(!state.location){$('departures').innerHTML='<div class="empty-state"><h3>Start with where you are.</h3><p>Choose a starting stop, or use your location<br>to compare services from stops around you.</p></div>';return;}
  const sequence=++state.nearbySequence,location={...state.location};
  if($('direct-only').checked&&!state.to){$('departures').innerHTML='<div class="error-state">Choose a destination to compare direct services heading there.</div>';return;}
  $('refresh').disabled=true;$('nearby-context').textContent=`Within 800 m of ${state.locationLabel}. Earliest departures with estimated time to walk are shown first.`;
  $('departures').innerHTML='<div class="loading">Checking the stops around you…</div>';
  try{
    // Scheduled results render immediately; live predictions are a progressive enhancement.
    const args={...location,to:$('direct-only').checked?state.to:null,mode:$('nearby-mode').value,now:aucklandNow(),feed:predictions,profile:accessProfile()};
    const data=await ask('nearby',args);if(sequence!==state.nearbySequence)return;renderDepartures(data);
    const fresh=await getPredictions();if(sequence!==state.nearbySequence)return;
    if(fresh.available){const updated=await ask('nearby',{...args,feed:fresh,now:aucklandNow()});if(sequence===state.nearbySequence)renderDepartures(updated);}
  }catch(error){if(sequence===state.nearbySequence)$('departures').innerHTML=`<div class="error-state">${escape(error.message)}</div>`;}
  finally{if(sequence===state.nearbySequence)$('refresh').disabled=false;}
}
function renderDepartures(data){
  state.departureData=data;$('more-stops').hidden=data.stops.length<=3;$('more-stops').textContent=state.showAllStops?'Show fewer stops':'Show more nearby stops';
  $('nearby-note').textContent=`Checked at ${clock(aucklandNow().seconds)}. ${data.message} Refresh when you need updated departure estimates. ${data.directOnly?'Showing direct services to your selected destination. ':''}${data.walkingSource==='mapped'?'Walking times follow mapped paths at your selected pace, with estimated access links.':'Walking times use distance estimates at your selected pace, not walking directions.'} Check crossings and station access. “Tight” allows a two-minute boarding buffer.`;
  if(!data.stops.length){$('departures').innerHTML=`<div class="empty-state"><h3>No upcoming ${data.directOnly?'direct ':''}services found.</h3><p>Try another stop, a different transport mode${data.directOnly?' or switch off the direct-service filter':''}.<br>We look up to two hours ahead within 800 metres, and up to 20 minutes along mapped walking paths when downloaded.</p></div>`;return;}
  $('departures').innerHTML=data.stops.slice(0,state.showAllStops?8:3).map((s,i)=>`<article class="stop-card"><div class="stop-header"><div>${i===0?'<span class="context-tag">First stop to consider</span>':''}<h3>${placeDetail(s.stop)}</h3><p>Stop ${escape(s.stop.code||s.stop.id)} · ${s.distance} m away</p></div><span class="walk-time">↗ ${s.walk} min walk est.</span></div>${s.departures.slice(0,3).map(d=>`<div class="departure-row ${d.tight?'tight':''}">${routeLink(escape(d.route),{tripId:d.trip},`route-badge detail-link ${d.mode}`)}<div class="departure-info"><strong>${escape(d.headsign||'See route destination')}</strong><small>${d.mode[0].toUpperCase()+d.mode.slice(1)}${d.tight?' · Tight on estimated walking time':''}</small></div><div class="departure-time"><strong>${d.minutes} <small>min</small></strong><small>${d.live?'● Live prediction':'Scheduled'}</small></div></div>`).join('')}</article>`).join('');
}
$('refresh').onclick=()=>{predictionsAt=0;refreshNearby();};$('nearby-mode').onchange=refreshNearby;$('direct-only').onchange=refreshNearby;
$('location').onclick=()=>{if(!navigator.geolocation){$('form-error').textContent='Location is unavailable in this browser. Choose a stop instead.';return;}$('location').disabled=true;$('location').textContent='Finding your location…';navigator.geolocation.getCurrentPosition(position=>{setPlace('origin',{id:`location:${position.coords.latitude.toFixed(5)},${position.coords.longitude.toFixed(5)}`,name:'Current location',lat:position.coords.latitude,lon:position.coords.longitude,placeType:'address'});state.locationLabel='your location';$('location').disabled=false;$('location').textContent='Use my current location';$('announcement').textContent='Current location selected. Continue when ready.';},()=>{$('location').disabled=false;$('location').textContent='Use my current location';$('form-error').textContent='Could not get your location. You can choose a stop or station instead.';},{enableHighAccuracy:false,timeout:12000,maximumAge:60000});};
$('try-britomart').onclick=async()=>{try{const matches=await ask('search',{query:'Waitemata'});const alternatives=matches.length?matches:await ask('search',{query:'Britomart'});const stop=alternatives.find(s=>s.kind===1)||alternatives[0];if(!stop)throw new Error('Try searching for Waitematā or Britomart in the origin field.');setPlace('origin',stop);review();}catch(error){$('form-error').textContent=error.message;}};
$('settings-open').onclick=()=>$('settings').showModal();document.querySelectorAll('.close-dialog').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$('learning-enabled').onchange=()=>{state.preferences.learning=$('learning-enabled').checked;persist();};
$('clear-history').onclick=()=>{state.preferences.journeys=[];persist();$('storage-message').textContent='Your journey history and saved routes have been cleared.';if(state.lastSearch)renderJourneys();if(state.selectedJourney)renderFollow();};
$('alerts-open').onclick=async()=>{$('alerts').showModal();$('alerts-content').innerHTML='<div class="loading">Checking service updates…</div>';try{const response=await fetch(new URL('./api/alerts',import.meta.url),{signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error();const data=await response.json();$('alerts-content').innerHTML=data.available?(data.alerts.length?data.alerts.map(a=>`<article class="alert-item"><h3>${escape(a.title)}</h3><p>${escape(a.description)}</p></article>`).join(''):'<p>No alerts returned by AT.</p>'):`<p>${escape(data.message)} You can view current announcements on the AT website when online.</p>`;}catch{$('alerts-content').innerHTML='<p>Service updates need an internet connection. Your downloaded timetable is still available.</p>';}};
let installPrompt;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('install').hidden=false;});
$('install').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;$('install').hidden=true;}};
function updateStatus(){
  $('data-status').textContent=state.ready?(state.stored&&state.shellReady&&state.streetsStored?(navigator.onLine?'Along · offline ready':'Offline · journeys ready'):state.streetsReady?'Along · session ready':'Preparing street search…'):'Loading AT timetable…';
}
function ready(result){state.ready=true;state.stored=result.stored;state.metadata=result.metadata;updateStatus();const end=result.metadata.feed_end_date||'';const expiry=end?`${end.slice(6,8)}/${end.slice(4,6)}/${end.slice(0,4)}`:'not specified';$('offline-info').textContent=`${result.stops.toLocaleString()} AT stops. Timetable ends ${expiry}. ${result.stored?'Stored on this device.':'Storage was unavailable; an internet connection will be needed on your next visit.'} Scheduled routing runs entirely in your browser.`;}
$('update-timetable').onclick=async()=>{$('update-timetable').disabled=true;$('offline-info').textContent='Downloading the latest timetable available on this server…';try{ready(await ask('update'));await loadStreets(true);}catch(error){$('offline-info').textContent=error.message;}finally{$('update-timetable').disabled=false;}};
window.addEventListener('online',()=>{updateStatus();if(state.location)refreshNearby();});window.addEventListener('offline',()=>{predictions={available:false};updateStatus();if(state.location)refreshNearby();});
// Departure updates are requested explicitly; avoid moving lists while people read.
history.replaceState({alongScreen:'destination',depth:0,intent:'plan'},'');showScreen('destination',{focus:false,historyEntry:false});
renderUsual();setNow();$('today').textContent=new Intl.DateTimeFormat('en-NZ',{timeZone:'Pacific/Auckland',weekday:'long',day:'numeric',month:'short'}).format(new Date());
if('serviceWorker' in navigator){navigator.serviceWorker.register(new URL('./sw.js',import.meta.url),{type:'module',updateViaCache:'none'}).then(registration=>{setupUpdates(registration);return navigator.serviceWorker.ready;}).then(()=>{state.shellReady=true;updateStatus();}).catch(()=>{});}
ask('init').then(async result=>{ready(result);navigator.storage?.persist?.().catch(()=>{});await loadStreets();}).catch(error=>{$('data-status').textContent='Timetable unavailable';$('form-error').textContent=error.message;$('offline-info').textContent=error.message;});
