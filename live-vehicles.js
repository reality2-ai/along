// A current position belongs to one verified, dated run, never just a route number.
const stamp=value=>(typeof value==='number'||(typeof value==='string'&&/^\d+$/.test(value)))&&Number.isSafeInteger(Number(value))&&Number(value)>0;
export function vehiclePosition(feed,run,{now=Date.now()/1000}={}){
  const unavailable=reason=>({available:false,reason});
  if(!Number.isFinite(now)||!feed?.available||!stamp(feed.updated)||Math.abs(now-Number(feed.updated))>180||!Array.isArray(feed.entities))return unavailable('unavailable');
  if(!run?.trip||!/^\d{8}$/.test(run.serviceDate||''))return unavailable('identity');
  const matches=feed.entities.filter(e=>e&&!e.is_deleted&&e.vehicle?.trip?.trip_id===run.trip&&e.vehicle.trip.start_date===run.serviceDate);
  if(matches.length!==1)return unavailable('unmatched');
  const vehicle=matches[0].vehicle,trip=vehicle.trip,position=vehicle.position;
  if((trip.route_id&&trip.route_id!==run.routeId)||(trip.start_time&&trip.start_time!==run.startTime))return unavailable('instance');
  if(trip.schedule_relationship!=null&&![0,'SCHEDULED'].includes(trip.schedule_relationship))return unavailable('unsupported-trip');
  // Feed creation time cannot establish when an individual GPS reading was taken.
  if(!stamp(vehicle.timestamp)||Math.abs(now-Number(vehicle.timestamp))>180)return unavailable('stale-position');
  if(!position||typeof position.latitude!=='number'||!Number.isFinite(position.latitude)||Math.abs(position.latitude)>90||typeof position.longitude!=='number'||!Number.isFinite(position.longitude)||Math.abs(position.longitude)>180)return unavailable('invalid-position');
  return {available:true,lat:position.latitude,lon:position.longitude,updated:Number(vehicle.timestamp),expires:Math.min(Number(feed.updated),Number(vehicle.timestamp))+180};
}
