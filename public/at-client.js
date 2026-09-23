import {createLiveClient} from './live-client.js';
const endpoints={predictions:'tripupdates',alerts:'servicealerts',vehicles:'vehiclelocations'};
const base='https://api.at.govt.nz/realtime/legacy/';
function timestamp(value){
  if(typeof value!=='number'&&!(typeof value==='string'&&/^\d+(\.\d+)?$/.test(value)))return null;
  const number=Number(value);
  return Number.isFinite(number)&&number>0&&Number.isSafeInteger(Math.floor(number))?Math.floor(number):null;
}
function english(field){
  const translations=Array.isArray(field?.translation)?field.translation.filter(t=>t&&typeof t.text==='string'):[];
  return (translations.find(t=>String(t.language||'en').toLowerCase().split('-')[0]==='en')||translations[0])?.text||'';
}
export function normaliseATFeed(kind,payload){
  if(!Object.hasOwn(endpoints,kind))return {available:false};
  const feed=payload?.response??payload,updated=timestamp(feed?.header?.timestamp);
  if(updated===null||!Array.isArray(feed?.entity))return {available:false};
  if(kind!=='alerts'){
    // AT's legacy JSON endpoint can encode a single stop update as an object.
    // Convert only that known shape; preserve arrays, restrictions and identities.
    const entities=kind==='predictions'?feed.entity.map(e=>{
      const update=e?.trip_update,event=update?.stop_time_update;
      if(event&&typeof event==='object'&&!Array.isArray(event)&&(Object.hasOwn(event,'stop_id')||Object.hasOwn(event,'stop_sequence')))
        return {...e,trip_update:{...update,stop_time_update:[event]}};
      return e;
    }):feed.entity;
    return {available:true,updated,entities};
  }
  const alerts=feed.entity.filter(e=>e&&!e.is_deleted&&e.alert&&typeof e.alert==='object').map(e=>{
    const a=e.alert;
    return {id:e.id,title:english(a.header_text),description:english(a.description_text),
      informed_entity:Object.hasOwn(a,'informed_entity')?a.informed_entity:[],active_period:Object.hasOwn(a,'active_period')?a.active_period:[],
      ...Object.fromEntries(['communication_period','impact_period','cause','effect'].filter(k=>Object.hasOwn(a,k)).map(k=>[k,a[k]]))};
  });
  return {available:true,updated,alerts};
}

// getKey is an injected application dependency, NOT an implemented Reality2 API.
// The owner must cancel this client on credential removal/rotation or TG lock.
// No key is persisted, returned, cached in the feed, or sent to an Along server.
export function createATClient({getKey,fetcher=globalThis.fetch,...options}={}){
  return createLiveClient({...options,baseURL:typeof getKey==='function'?base:'',fetcher:async(url,request)=>{
    const kind=new URL(url).pathname.split('/').at(-1);
    if(!Object.hasOwn(endpoints,kind))throw new Error('Unknown AT feed.');
    const key=await new Promise((resolve,reject)=>{
      const abort=()=>reject(new Error('Cancelled'));
      if(request.signal.aborted){abort();return;}
      request.signal.addEventListener('abort',abort,{once:true});
      const cleanup=()=>request.signal.removeEventListener('abort',abort);
      try{Promise.resolve(getKey()).then(value=>{cleanup();resolve(value);},()=>{cleanup();reject(new Error('Credential unavailable'));});}
      catch{cleanup();reject(new Error('Credential unavailable'));}
    });
    if(request.signal.aborted)throw new Error('Cancelled');
    if(typeof key!=='string'||!key||key.length>4096||/\s/.test(key))throw new Error('Credential unavailable');
    const response=await fetcher(base+endpoints[kind],{...request,
      headers:{Accept:'application/json','Ocp-Apim-Subscription-Key':key}});
    return {ok:response.ok,json:async()=>normaliseATFeed(kind,await response.json())};
  }});
}
