// Match a downloaded departure to one dated GTFS trip instance. No mutation.
const integer=value=>(typeof value==='number'||(typeof value==='string'&&/^-?\d+$/.test(value)))&&Number.isSafeInteger(Number(value));
const scheduled=reason=>({status:'scheduled',reason});
export function departurePrediction(feed,departure,{now=Date.now()/1000}={}){
  if(!feed?.available || !integer(feed.updated) || !Number.isFinite(now) || Math.abs(now-Number(feed.updated))>180 || !Array.isArray(feed.entities))return scheduled('unavailable');
  if(!departure?.trip || !/^\d{8}$/.test(departure.serviceDate||''))return scheduled('identity');
  const matches=feed.entities.filter(e=>e && !e.is_deleted && e.trip_update?.trip?.trip_id===departure.trip && e.trip_update.trip.start_date===departure.serviceDate);
  if(matches.length!==1)return scheduled('unmatched');
  const update=matches[0].trip_update,trip=update.trip;
  if(trip.route_id && trip.route_id!==departure.routeId)return scheduled('route');
  if(trip.start_time && trip.start_time!==departure.startTime)return scheduled('instance');
  if([3,'CANCELED'].includes(trip.schedule_relationship))return {status:'cancelled',updated:feed.updated};
  if(trip.schedule_relationship!=null && ![0,'SCHEDULED'].includes(trip.schedule_relationship))return scheduled('unsupported-trip');
  if(!Array.isArray(update.stop_time_update))return scheduled('no-stop');
  // The compact timetable currently has no source stop_sequence. A loop visit
  // must not be guessed from stop_id alone, even if only one update is present.
  if(departure.stopVisits!==1)return scheduled('ambiguous-stop');
  const events=update.stop_time_update.filter(e=>e?.stop_id===departure.stop.id);
  if(events.length!==1)return scheduled('unmatched-stop');
  const event=events[0];
  if(event.stop_time_properties?.assigned_stop_id && event.stop_time_properties.assigned_stop_id!==departure.stop.id)return scheduled('changed-stop');
  if([1,'SKIPPED'].includes(event.schedule_relationship))return {status:'skipped',updated:feed.updated};
  if(event.schedule_relationship!=null && ![0,'SCHEDULED'].includes(event.schedule_relationship))return scheduled('no-prediction');
  const value=event.departure;
  if(!value)return scheduled('no-departure');
  if(Object.hasOwn(value,'time')){
    if(!integer(value.time)||Number(value.time)<=0||Number(value.time)>8640000000000)return scheduled('invalid-time');
    return {status:'predicted',epoch:Number(value.time),updated:feed.updated};
  }
  if(integer(value.delay)&&Number(value.delay)>=-2147483648&&Number(value.delay)<=2147483647)return {status:'predicted',delay:Number(value.delay),updated:feed.updated};
  return scheduled('invalid-delay');
}

// Source stop_sequence is not in the compact timetable. Count full-trip visits
// (including the final arrival), never only the current two-hour search window.
export function tripStopMetadata(data,stops,tripIds){
  const wanted=new Map([...tripIds].map(id=>[id,{visits:new Map(),first:Infinity,last:-Infinity,end:null}]));
  if(!wanted.size)return wanted;
  const c=data.connections;
  for(let i=0;i<c.length;i+=7){
    const run=wanted.get(data.trips[c[i]][0]);if(!run)continue;
    const stop=stops[c[i+1]].id;
    run.visits.set(stop,(run.visits.get(stop)||0)+1);run.first=Math.min(run.first,c[i+3]);
    if(c[i+4]>=run.last){run.last=c[i+4];run.end=stops[c[i+2]].id;}
  }
  for(const run of wanted.values()){
    if(run.end!==null)run.visits.set(run.end,(run.visits.get(run.end)||0)+1);
    run.startTime=Number.isFinite(run.first)?[Math.floor(run.first/3600),Math.floor(run.first%3600/60),run.first%60].map(n=>String(n).padStart(2,'0')).join(':'):null;
  }
  return wanted;
}
