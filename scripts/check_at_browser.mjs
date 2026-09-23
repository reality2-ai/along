// Explicit authenticated verification only. Never run as part of ordinary tests.
// No traces, screenshots, request logs, credentials or raw feeds are saved.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium} from '@playwright/test';
let browser;
try{
 const key=(process.env.AT_API_KEY??await readFile(new URL('../APIKey',import.meta.url),'utf8')).trim();
 if(!key||key.length>4096||/\s/.test(key))throw new Error('Invalid credential');
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 const context=await browser.newContext({serviceWorkers:'block'});
 const page=await context.newPage();
 // Simulate the actual page origin locally; no changes to the public website.
 await page.route('https://reality2.ai/along/__direct-at-check',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Local AT browser verification</title>'}));
 const modules=['at-client.js','live-client.js','live-predictions.js','live-vehicles.js','planner.js','preferences.js'];
 for(const name of modules){const body=await readFile(new URL('../public/'+name,import.meta.url),'utf8');await page.route('https://reality2.ai/along/'+name,r=>r.fulfill({contentType:'text/javascript',body}));}
 const network=await readFile(new URL('../data/network.json.gz',import.meta.url));
 await page.route('https://reality2.ai/along/__network.gz',r=>r.fulfill({contentType:'application/gzip',body:network}));
 await page.goto('https://reality2.ai/along/__direct-at-check');
 const audit=await page.evaluate(async credential=>{
  let stage='modules';try{
  const {createATClient}=await import('./at-client.js');
  const {Planner}=await import('./planner.js');
  const {tripStopMetadata,departurePrediction}=await import('./live-predictions.js');
  const {vehiclePosition}=await import('./live-vehicles.js');
  stage='timetable';
  const compressed=await fetch('./__network.gz');
  const network=await new Response(compressed.body.pipeThrough(new DecompressionStream('gzip'))).json();
  stage='planner';
  const planner=new Planner(network),trips=new Map(network.trips.map(t=>[t[0],t]));
  const client=createATClient({getKey:()=>credential,timeoutMs:15000});
  stage='AT feeds';
  const raw={};for(const kind of ['predictions','alerts','vehicles'])raw[kind]=await client.read(kind,{requested:true});
  const results={};for(const [kind,feed] of Object.entries(raw))results[kind]={available:feed.available,updated:feed.updated??null,records:(feed.entities||feed.alerts||[]).length};
  const ids=new Set();for(const kind of ['predictions','vehicles'])for(const e of raw[kind].entities||[]){const id=(e.trip_update||e.vehicle)?.trip?.trip_id;if(trips.has(id))ids.add(id);}
  stage='trip metadata';
  const metadata=tripStopMetadata(network,planner.stops,ids),days=new Map();
  // Resolve live references against original downloaded boarding calls. Never
  // copy a provider sequence into an otherwise unverified departure identity.
  const calls=new Map();
  for(let i=0;i<network.connections.length;i+=7){
   const trip=network.trips[network.connections[i]][0];if(!ids.has(trip))continue;
   const call={stop:planner.stops[network.connections[i+1]],stopSequence:network.connectionSequences?.[i/7]};
   if(!calls.has(trip))calls.set(trip,[]);calls.get(trip).push(call);
  }
  const count=(counts,key)=>counts[key]=(counts[key]||0)+1;
  const identity=trip=>{
   const t=trips.get(trip?.trip_id);if(!t)return {reason:'trip-not-in-download'};
   const day=trip.start_date;if(!/^\d{8}$/.test(day||''))return {reason:'missing-service-date'};
   if(!days.has(day))days.set(day,planner.active(day.slice(0,4)+'-'+day.slice(4,6)+'-'+day.slice(6)));
   if(!days.get(day).has(t[2]))return {reason:'inactive-service-date'};
   return {trip:t[0],routeId:network.routes[t[1]][0],serviceDate:day,startTime:metadata.get(t[0])?.startTime};
  };
  const matching={prediction_trips:{},prediction_stops:{},sequence_resolution:{},vehicles:{}};
  stage='prediction matching';
  for(const e of raw.predictions.entities||[]){
   if(e.is_deleted||!e.trip_update)continue;
   const update=e.trip_update,run=identity(update.trip);count(matching.prediction_trips,run.reason||'verified');if(run.reason)continue;
   const seen=new Set();
   if(!Array.isArray(update.stop_time_update)){count(matching.prediction_stops,'no-stop-array');if(!matching.stop_update_shape){const value=update.stop_time_update;matching.stop_update_shape={type:typeof value,keys:value&&typeof value==='object'?Object.keys(value).slice(0,6):[]};}continue;}
   for(const event of update.stop_time_update){
    if(!event||typeof event!=='object'){count(matching.prediction_stops,'invalid-stop-event');continue;}
    const sequence=event.stop_sequence;
    const hasSequence=sequence!=null;
    const validSequence=(typeof sequence==='number'||(typeof sequence==='string'&&/^\d+$/.test(sequence)))&&Number.isSafeInteger(Number(sequence))&&Number(sequence)>=0;
    const candidates=(calls.get(run.trip)||[]).filter(call=>hasSequence
     ?validSequence&&call.stopSequence===Number(sequence):call.stop.id===event.stop_id);
    if(!candidates.length){
     const knownStop=metadata.get(run.trip)?.visits.has(event.stop_id);
     const boardingStop=(calls.get(run.trip)||[]).some(call=>call.stop.id===event.stop_id);
     count(matching.sequence_resolution,knownStop&&!boardingStop?'terminal-arrival-only':boardingStop?'unmatched-source-sequence':'stop-not-on-downloaded-trip');continue;
    }
    for(const call of candidates){
     const visit=JSON.stringify([call.stop.id,call.stopSequence]);if(seen.has(visit))continue;seen.add(visit);
     const departure={...run,...call,stopVisits:metadata.get(run.trip)?.visits.get(call.stop.id)};
     const prediction=departurePrediction(raw.predictions,departure);
     count(matching.prediction_stops,prediction.status==='scheduled'?prediction.reason:prediction.status);
     if(prediction.status==='predicted'&&departure.stopVisits>1){
      const legacy=departurePrediction(raw.predictions,{...departure,stopSequence:undefined});
      count(matching.sequence_resolution,legacy.reason==='ambiguous-stop'?'repeated-stop-resolved':'repeated-stop-predicted');
     }
    }
   }
  }
  stage='vehicle matching';
  for(const e of raw.vehicles.entities||[]){
   if(e.is_deleted||!e.vehicle)continue;
   const run=identity(e.vehicle.trip);if(run.reason){count(matching.vehicles,run.reason);continue;}
   const position=vehiclePosition(raw.vehicles,run);count(matching.vehicles,position.available?'matched':position.reason);
  }
  client.cancel();return {feeds:results,matching};
  }catch(error){return {audit_error:true,stage,error_type:error.name,error_location:String(error.stack).split('\n').slice(1,4).map(line=>line.trim())};}
 },key);
 const report={checked_at:new Date().toISOString(),browser:browser.version(),page_origin:'https://reality2.ai',
  harness:'Locally fulfilled test page at the app origin; real cross-origin AT requests through Chromium.',
  credential_recorded:false,public_live_enabled:false,...audit};
 await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
 await writeFile(new URL('../test-results/at-direct-browser.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
 if(audit.audit_error||!Object.values(audit.feeds).every(f=>f.available))process.exitCode=1;
}catch{console.error('Direct AT browser verification could not complete. No credential details recorded.');process.exitCode=1;}
finally{await browser?.close();}
