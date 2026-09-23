import {findRoutes,routeDetails,stopDetails} from './explore.js';
import {Planner} from './planner.js';
import {StreetGraph} from './streets.js';
let planner,routeGeometry;
async function loadRoutes(refresh=false){
 let data=refresh?null:await load('routes').catch(()=>null);
 if(!data){data=await fetchBundle('routes');await save(data,'routes');}
 routeGeometry=data;
}

async function fetchBundle(name){
  const response=await fetch(new URL(`./data/${name}.json.gz`,import.meta.url));
  if(!response.ok)throw new Error('Offline data could not be downloaded. Connect and try again.');
  if(!globalThis.DecompressionStream)throw new Error('Please use a current browser with offline compression support.');
  const stream=response.body.pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).json();
}
function database(){return new Promise((resolve,reject)=>{const req=indexedDB.open('along-device-preview-offline',1);req.onupgradeneeded=()=>req.result.createObjectStore('timetable');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function load(key='network'){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('timetable');const req=tx.objectStore('timetable').get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);tx.oncomplete=()=>db.close();});}
async function save(data,key='network'){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('timetable','readwrite');tx.objectStore('timetable').put(data,key);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};tx.onabort=()=>reject(tx.error);});}
async function init(refresh=false){
  let data,stored=false;
  if(!refresh){try{data=await load();stored=!!data;}catch{ /* Private browsing may not allow persistence. */ }}
  if(!data)data=await fetchBundle('network');
  else if(!data.accessibilityVersion){try{data=await fetchBundle('network');stored=false;}catch{}}
  const next=new Planner(data);
  // A timetable refresh must not discard a usable walking map if the later
  // street download fails. Rebuild stop snaps against the new timetable.
  if(planner?.streets)next.setStreets(planner.streets);
  if(!stored){try{await save(data);stored=true;}catch{stored=false;}}
  planner=next;
  return {metadata:data.metadata,stored,stops:planner.stops.length};
}
async function streets(refresh=false){
  let graphData,addressData,stored=false;
  if(!refresh){try{graphData=await load('streets');addressData=await load('addresses');stored=!!graphData&&!!addressData;}catch{}}
  for(const name of ['streets','addresses']){
    if(name==='streets'?graphData?.accessibilityVersion:addressData)continue;
    const data=await fetchBundle(name);if(name==='streets')graphData=data;else addressData=data;stored=false;
  }
  const graph=new StreetGraph(graphData,addressData);
  planner.setStreets(graph);
  if(!stored){try{await save(graphData,'streets');await save(addressData,'addresses');stored=true;}catch{stored=false;}}
  try{await loadRoutes(refresh);}catch{ /* Route lists still work without geometry. */ }
  return {routeMaps:!!routeGeometry,stored,addresses:graph.addresses.length,metadata:graphData.metadata};
}
self.addEventListener('message',async({data:{id,type,args}})=>{
  try{
    let result;
    if(type==='init'||type==='update')result=await init(type==='update');
    else {if(!planner)throw new Error('The timetable is still loading. Please try again in a moment.');
      if(type==='streets')result=await streets(!!args.refresh);
      else if(type==='search'){
        const stops=planner.search(args.query),addresses=planner.streets?.search(args.query)||[];
        result=/^\s*\d/.test(args.query)?[...addresses,...stops].slice(0,12):[...stops.slice(0,6),...addresses.slice(0,6)];
      }
      else if(type==='plan')result=planner.plan(args);
      else if(type==='routes')result=findRoutes(planner,args.query);
      else if(type==='routeDetails')result=routeDetails(planner,args,routeGeometry);
      else if(type==='stopDetails')result=stopDetails(planner,args);
      else if(type==='nearby')result=planner.nearby(args);
      else throw new Error('Unknown request.');
    }
    self.postMessage({id,result});
  }catch(error){self.postMessage({id,error:error.message});}
});
