// Convert the displayed Auckland wall time to an instant without using the
// device timezone. Reject ambiguous or missing DST wall times rather than guess.
const formatter=new Intl.DateTimeFormat('en-NZ',{timeZone:'Pacific/Auckland',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function wall(epoch){
 const p=Object.fromEntries(formatter.formatToParts(new Date(epoch*1000)).map(p=>[p.type,p.value]));
 return Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute),Number(p.second))/1000;
}
export function aucklandWallEpoch(date,seconds){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!Number.isSafeInteger(seconds)||Math.abs(seconds)>172800)return null;
 const midnight=Date.parse(date+'T00:00:00Z');
 if(!Number.isFinite(midnight)||new Date(midnight).toISOString().slice(0,10)!==date)return null;
 const target=midnight/1000+seconds,offsets=new Set();
 for(const hours of [-36,0,36]){const epoch=target+hours*3600;offsets.add(wall(epoch)-epoch);}
 const matches=[...offsets].map(offset=>target-offset).filter(epoch=>wall(epoch)===target);
 return matches.length===1?matches[0]:null;
}
export function stopAlertContexts(place,rows,at){
 const start=aucklandWallEpoch(at.date,at.seconds),end=aucklandWallEpoch(at.date,at.seconds+7200);
 if(start===null||end===null)return [];
 const contexts=[{stop_id:place.id,start,end}];
 for(const row of rows){
  const instant=aucklandWallEpoch(at.date,row.departure);if(instant===null)continue;
  contexts.push({stop_id:row.stop.id,route_id:row.routeId,route_type:row.routeType,agency_id:row.agencyId,direction_id:row.directionId,
   trip:{trip_id:row.trip,route_id:row.routeId,direction_id:row.directionId,start_date:row.serviceDate,start_time:row.startTime},start:instant,end:instant});
 }
 return contexts;
}


export function journeyAlertContexts(legs,date){
 const contexts=[];
 for(const leg of legs){
  if(!leg.trip || !leg.routeId || !leg.serviceDate)continue;
  const start=aucklandWallEpoch(date,leg.departure),end=aucklandWallEpoch(date,leg.arrival);
  if(start===null||end===null||end<start)continue;
  const identity={route_id:leg.routeId,route_type:leg.routeType,agency_id:leg.agencyId,direction_id:leg.directionId,
   trip:{trip_id:leg.trip,route_id:leg.routeId,direction_id:leg.directionId,start_date:leg.serviceDate,start_time:leg.startTime}};
  contexts.push({...identity,start,end});
  for(const call of leg.calls||[]){
   const arrival=aucklandWallEpoch(date,call.arrival),departure=aucklandWallEpoch(date,call.departure);
   if(arrival!==null&&departure!==null&&arrival<=departure)contexts.push({...identity,stop_id:call.stopId,start:arrival,end:departure});
  }
 }
 return contexts;
}
