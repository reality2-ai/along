// Read-only timetable exploration; no location, learning or journey-state mutation.
export function findRoutes(planner,query){
  const q=query.trim().toLocaleLowerCase();if(!q)return [];
  return planner.data.routes.map((r,i)=>({id:r[0],number:r[1]||r[2],name:r[2],mode:planner.mode(i)}))
    .filter(r=>`${r.number} ${r.name}`.toLocaleLowerCase().includes(q))
    .sort((a,b)=>(b.number.toLowerCase()===q)-(a.number.toLowerCase()===q)||a.number.localeCompare(b.number)).slice(0,30);
}
export function routeDetails(planner,{routeId,tripId,date,time='00:00'},geometry){
  const {routes,trips,connections:c}=planner.data;
  const ri=routeId?routes.findIndex(r=>r[0]===routeId):trips.find(t=>t[0]===tripId)?.[1];
  if(ri===undefined||ri<0)throw new Error('This route is not in the downloaded timetable.');
  const active=planner.active(date),wanted=new Set();trips.forEach((t,i)=>{if(t[1]===ri&&active.has(t[2]))wanted.add(i);});
  const runs=new Map();
  for(let i=0;i<c.length;i+=7)if(wanted.has(c[i])){if(!runs.has(c[i]))runs.set(c[i],[]);runs.get(c[i]).push(i);}
  const patterns=new Map(),now=time.split(':').reduce((a,n)=>a*60+Number(n),0)*60;
  for(const [ti,rows] of runs){
    rows.sort((a,b)=>c[a+3]-c[b+3]||c[a+4]-c[b+4]);
    const stops=rows.map(i=>({stop:planner.stops[c[i+1]],time:c[i+3],pickup:c[i+5]===0}));
    const last=rows.at(-1);stops.push({stop:planner.stops[c[last+2]],time:c[last+4],pickup:false});
    const trip=trips[ti],shape=geometry?.trips[trip[0]],key=trip[3]+'|'+stops.map(s=>s.stop.id).join(',')+'|'+(shape||'');
    const run={trip:trip[0],departure:stops[0].time,stops};
    if(!patterns.has(key))patterns.set(key,{headsign:trip[3],shape:geometry?.shapes[shape]||null,runs:[]});
    patterns.get(key).runs.push(run);
  }
  const variants=[...patterns.values()].map(v=>{
    v.runs.sort((a,b)=>a.departure-b.departure);
    const chosen=v.runs.find(r=>r.trip===tripId)||v.runs.find(r=>r.departure>=now)||v.runs.at(-1);
    return {...v,selectedTrip:chosen.trip,stops:chosen.stops};
  }).sort((a,b)=>(b.selectedTrip===tripId)-(a.selectedTrip===tripId)||a.headsign.localeCompare(b.headsign));
  return {id:routes[ri][0],number:routes[ri][1]||routes[ri][2],name:routes[ri][2],mode:planner.mode(ri),date,variants};
}
export function stopDetails(planner,{id,now}){
  const ids=new Set(planner.group(id)),seen=new Set(),departures=[];
  for(const [departure,,ti,a,,pickup,,offset] of planner.connections(now.date,now.seconds,now.seconds+7200,['bus','train','ferry'])){
    if(!ids.has(a)||pickup!==0)continue;
    const trip=planner.data.trips[ti],route=planner.data.routes[trip[1]],key=`${ti}:${offset}:${a}:${departure}`;
    if(seen.has(key))continue;seen.add(key);
    const serviceDate=new Date(Date.parse(now.date+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10).replaceAll('-','');
    departures.push({serviceDate,trip:trip[0],routeId:route[0],route:route[1]||route[2],headsign:trip[3],departure,stop:planner.stops[a],mode:planner.mode(trip[1])});
  }
  const result=departures.sort((a,b)=>a.departure-b.departure).slice(0,30);
  const wanted=new Map(result.map(d=>[d.trip,{visits:new Map(),first:Infinity,last:-Infinity,end:null}]));
  const c=planner.data.connections;
  for(let i=0;i<c.length;i+=7){
    const run=wanted.get(planner.data.trips[c[i]][0]);if(!run)continue;
    const stop=planner.stops[c[i+1]].id;
    run.visits.set(stop,(run.visits.get(stop)||0)+1);run.first=Math.min(run.first,c[i+3]);
    if(c[i+4]>run.last){run.last=c[i+4];run.end=planner.stops[c[i+2]].id;}
  }
  for(const run of wanted.values())run.visits.set(run.end,(run.visits.get(run.end)||0)+1);
  for(const departure of result){const run=wanted.get(departure.trip);
    departure.stopVisits=run.visits.get(departure.stop.id)||0;
    departure.startTime=[Math.floor(run.first/3600),Math.floor(run.first%3600/60),run.first%60].map(n=>String(n).padStart(2,'0')).join(':');
  }
  return result;
}
