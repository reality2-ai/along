import {departurePrediction,tripStopMetadata} from './live-predictions.js';
import {normaliseRoutes,journeyRoutes,sameRoutes} from './preferences.js';
// Runs in a Web Worker. The entire network stays on the device, including searches.
export const zone = 'Pacific/Auckland';
export function aucklandNow(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-NZ', {timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
  return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`,seconds:Number(parts.hour)*3600+Number(parts.minute)*60+Number(parts.second)};
}
const shiftDate = (day, offset) => new Date(Date.parse(day+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);
const compactDate = day => day.replaceAll('-','');
const normalise = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();
export function metres(lat,lon,stop) {
  const r = Math.PI/180, a=lat*r,b=stop.lat*r;
  const h = Math.sin((b-a)/2)**2+Math.cos(a)*Math.cos(b)*Math.sin((stop.lon-lon)*r/2)**2;
  return 6371000*2*Math.asin(Math.min(1,Math.sqrt(h)));
}

export class Planner {
  constructor(data) {
    if(data.version !== 1) throw new Error('Please update Along to read this timetable.');
    this.data=data;
    this.stops=data.stops.map(([id,code,name,lat,lon,parent,kind,wheelchair=0])=>({id,code,name,lat,lon,parent,kind,wheelchair}));
    this.stopIndex=new Map(this.stops.map((s,i)=>[s.id,i]));
    this.groups=new Map();
    this.stops.forEach((s,i)=>{ const key=s.parent||s.id; if(!this.groups.has(key)) this.groups.set(key,[]); this.groups.get(key).push(i); });
    this.links=new Map(); this.rules=new Map();
    const link=(a,b,seconds)=>{if(!this.links.has(a))this.links.set(a,new Map());this.links.get(a).set(b,seconds);};
    for(const group of this.groups.values()) for(const a of group) for(const b of group) if(a!==b) link(a,b,180);
    for(const [a,b,type,seconds] of data.transfers){
      const ai=this.stopIndex.get(a),bi=this.stopIndex.get(b);
      if(ai===undefined||bi===undefined) continue;
      this.rules.set(`${ai}:${bi}`,{type,seconds});
      if(ai!==bi){if(type===3)this.links.get(ai)?.delete(bi);else link(ai,bi,Math.max(120,seconds));}
    }
    if(!(data.connections instanceof Int32Array)) data.connections=new Int32Array(data.connections);
  }
  setStreets(graph){
    this.streets=graph;this.stopSnaps=this.stops.map(s=>graph.snap(s));this.stopsByNode=new Map();this.streetTransfers=new Map();
    this.stopSnaps.forEach((snap,i)=>{if(!snap||this.stops[i].kind!==0)return;if(!this.stopsByNode.has(snap.node))this.stopsByNode.set(snap.node,[]);this.stopsByNode.get(snap.node).push(i);});
  }
  setProfile(profile={}){
    const next={avoidSteps:!!profile.avoidSteps,pace:[0.8,1,1.25].includes(profile.pace)?profile.pace:1.25,confirmedAccess:!!profile.confirmedAccess};
    if(next.avoidSteps&&(!this.streets||!this.streets.data.accessibilityVersion))throw new Error('Download the latest street map to avoid mapped steps and barriers.');
    if(next.confirmedAccess&&!this.data.accessibilityVersion)throw new Error('Update the timetable to check vehicle and stop accessibility.');
    if(JSON.stringify(next)!==JSON.stringify(this.profile)){this.profile=next;if(this.streets){this.streets.profile=next;this.setStreets(this.streets);}}
  }
  accessibleStop(index){const s=this.stops[index];return s.wheelchair===1||(s.wheelchair===0&&s.parent&&this.stops[this.stopIndex.get(s.parent)]?.wheelchair===1);}
  place(value){
    const id=typeof value==='string'?value:value?.id,index=this.stopIndex.get(id);
    if(index!==undefined)return this.stops[index];
    if(value?.placeType==='address'&&Number.isFinite(value.lat)&&Number.isFinite(value.lon)&&value.id&&value.name)return value;
    throw new Error('Choose an address or stop from the suggestions.');
  }
  walkingLeg(from,to,departure,seconds,extra={}){return {mode:'walk',from,to,departure,arrival:departure+seconds,...extra};}
  access(place,maxSeconds,reverse=false){
    if(place.placeType!=='address')return new Map(this.group(place.id).filter(i=>!this.profile?.confirmedAccess||this.accessibleStop(i)).map(i=>[i,0]));
    if(!this.streets)throw new Error('Street data is still loading. Stop-to-stop journeys are available now.');
    const tree=this.streets.reach(place,maxSeconds,reverse),stops=new Map();
    this.stopSnaps.forEach((snap,i)=>{if(!snap||this.stops[i].kind!==0||(this.profile?.confirmedAccess&&!this.accessibleStop(i)))return;const seconds=tree.distance.get(snap.node);if(seconds!==undefined&&seconds+snap.seconds<=maxSeconds)stops.set(i,Math.ceil(seconds+snap.seconds));});
    return stops;
  }
  transfersFrom(stop){
    if(!this.streets)return this.links.get(stop)||new Map();
    if(this.streetTransfers.has(stop))return this.streetTransfers.get(stop);
    const links=this.profile?.avoidSteps?new Map():new Map(this.links.get(stop)||[]),tree=this.streets.reach(this.stops[stop],600);
    for(const [node,cost] of tree.distance)for(const target of this.stopsByNode.get(node)||[]){
      if(target===stop)continue;const seconds=Math.ceil(cost+this.stopSnaps[target].seconds),rule=this.rules.get(`${stop}:${target}`);
      if(seconds>600||rule?.type===3)continue;
      // Keep GTFS transfer minima. A street link cannot override a forbidden transfer.
      const duration=Math.max(30,seconds,rule?.seconds||0);
      if(!links.has(target)||duration<links.get(target))links.set(target,duration);
    }
    this.streetTransfers.set(stop,links);return links;
  }
  mode(route){const type=this.data.routes[route][3];return [0,1,2].includes(type)?'train':type===4?'ferry':'bus';}
  search(query){const q=normalise(query.trim()),words=q.split(/\s+/);if(!q)return [];
    return this.stops.filter(s=>words.every(w=>normalise(s.name+' '+s.code).includes(w)))
      .sort((a,b)=>(b.code===q)-(a.code===q)||(b.kind===1)-(a.kind===1)||a.name.length-b.name.length||a.code.localeCompare(b.code)).slice(0,15);
  }
  group(id){const i=this.stopIndex.get(id);if(i===undefined)throw new Error('Choose a stop from the suggestions.');return this.stops[i].kind===1?this.groups.get(id):[i];}
  active(day){const key=compactDate(day),weekday=(new Date(day+'T12:00:00Z').getUTCDay()+6)%7;
    const active=new Set(this.data.calendar.filter(([,start,end,days])=>start<=key&&key<=end&&days[weekday]==='1').map(r=>r[0]));
    for(const [service,date,type] of this.data.exceptions)if(date===key){if(type===1)active.add(service);else active.delete(service);}return active;
  }
  checkDate(day){const key=compactDate(day),meta=this.data.metadata;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+'T12:00:00Z')))throw new Error('Choose a valid date.');
    if(key<(meta.feed_start_date||'00000000')||key>(meta.feed_end_date||'99999999'))throw new Error('This date is outside the downloaded timetable. Update your timetable in settings.');
  }
  // Connections are sorted by departure; binary search avoids scanning a whole week.
  range(start,end){const c=this.data.connections,n=c.length/7;let lo=0,hi=n;while(lo<hi){const mid=(lo+hi)>>>1;if(c[mid*7+3]<start)lo=mid+1;else hi=mid;}const begin=lo*7;lo=0;hi=n;while(lo<hi){const mid=(lo+hi)>>>1;if(c[mid*7+3]<=end)lo=mid+1;else hi=mid;}return [begin,lo*7];}
  connections(day,start,end,modes){const c=this.data.connections,out=[];
    for(const offset of [-1,0,1]){const active=this.active(shiftDate(day,offset)),shift=offset*86400,[lo,hi]=this.range(start-shift,end-shift);
      for(let i=lo;i<hi;i+=7){const trip=this.data.trips[c[i]];if(active.has(trip[2])&&modes.includes(this.mode(trip[1])))out.push([c[i+3]+shift,c[i+4]+shift,c[i],c[i+1],c[i+2],c[i+5],c[i+6],offset]);}
    }return out.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  }
  plan({from,to,date,time,modes,maxWalk=900,profile={},preferredRoutes=null,routeSequence=null}){
    const preference=normaliseRoutes(preferredRoutes);
    if(preference){
      const args={from,to,date,time,modes,maxWalk,profile};
      const alternatives=this.plan(args);
      // Search the chosen service sequence separately: it may be slower and
      // therefore absent from the ordinary earliest-arrival options.
      const preferred=preference.length?this.plan({...args,routeSequence:preference}):alternatives.filter(j=>j.walkOnly);
      const signature=j=>JSON.stringify(j.legs.map(l=>[l.mode,l.trip,l.from.id,l.to.id,l.departure]));
      const seen=new Set(preferred.map(signature));
      return [...preferred,...alternatives.filter(j=>!seen.has(signature(j)))].map(j=>({...j,preferred:sameRoutes(journeyRoutes(j),preference)}));
    }
    this.setProfile(profile);
    this.checkDate(date);const origin=this.place(from),destination=this.place(to);
    if(origin.id===destination.id)throw new Error('Choose two different stops or addresses.');
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error('Choose a valid departure time.');
    if(!modes?.length||modes.some(m=>!['bus','train','ferry'].includes(m)))throw new Error('Select at least one transport mode.');
    if(![300,600,900,1200].includes(maxWalk))throw new Error('Choose a walking preference between 5 and 20 minutes.');
    const starts=this.access(origin,maxWalk),ends=this.access(destination,maxWalk,true);
    if(origin.placeType!=='address'&&destination.placeType!=='address'&&[...starts.keys()].some(s=>ends.has(s)))throw new Error('These stops belong to the same station.');
    const [h,m]=time.split(':').map(Number),seconds=h*3600+m*60,horizon=seconds+14400;
    const connections=this.connections(date,seconds,horizon,modes),results=[];
    let previous=new Map([...starts].map(([s,walk])=>[s,{arrival:seconds+walk,path:origin.placeType==='address'?[this.walkingLeg(origin,this.stops[s],seconds,walk,{access:true})]:[],walking:walk}]));
    if(!routeSequence&&this.streets&&(origin.placeType==='address'||destination.placeType==='address')){
      const walk=this.streets.route(origin,destination,maxWalk);
      if(walk)results.push({departure:seconds,arrival:seconds+walk.seconds,duration:walk.seconds,wait:0,transfers:0,walking:walk.seconds,walkOnly:true,legs:[this.walkingLeg(origin,destination,seconds,walk.seconds,{directions:walk})]});
    }
    if(routeSequence&&(!starts.size||!ends.size))return [];
    if((!starts.size||!ends.size)&&!results.length)throw new Error(this.profile.confirmedAccess?'AT’s timetable does not confirm accessibility for the required stops. We cannot verify a wheelchair-accessible journey.':'No connected stops within your walking preference. Try a longer walk or choose a nearby stop.');
    for(let boardings=1;boardings<=(routeSequence?.length||4);boardings++){
      const current=new Map(),onboard=new Map();
      for(const [dep,arr,ti,a,b,pickup,dropoff,offset] of connections){
        if(this.profile.confirmedAccess&&this.data.trips[ti][4]!==1)continue;
        if(routeSequence){const ri=this.data.trips[ti][1],route=this.data.routes[ri],wanted=routeSequence[boardings-1];if(this.mode(ri)!==wanted.mode||(route[1]||route[2])!==wanted.route)continue;}
        if(arr>horizon)continue;const key=`${ti}:${offset}`,base=previous.get(a),rule=this.rules.get(`${a}:${a}`)||{type:0,seconds:120};
        let rider=onboard.get(key),buffer=boardings===1?(origin.placeType==='address'?60:0):Math.max(120,rule.seconds);
        if(!rider&&pickup===0&&base&&base.arrival+buffer<=dep&&(boardings===1||rule.type!==3)&&(!this.profile.confirmedAccess||this.accessibleStop(a))){
          const [trip,ri,,headsign]=this.data.trips[ti],route=this.data.routes[ri];
          rider={path:base.path,walking:base.walking,leg:{mode:this.mode(ri),route:route[1]||route[2],routeId:route[0],headsign,trip,origin:a,destination:b,departure:dep,arrival:arr,stops:0}};
        }
        if(!rider)continue;
        const leg={...rider.leg,destination:b,arrival:arr,stops:rider.leg.stops+1};onboard.set(key,{...rider,leg});
        if(dropoff===0&&(!this.profile.confirmedAccess||this.accessibleStop(b))&&(!current.has(b)||arr<current.get(b).arrival)){
          const path=[...rider.path,leg];current.set(b,{arrival:arr,path,walking:rider.walking});
          for(const [linked,duration] of this.transfersFrom(b)){const ready=arr+duration;
            if(!current.has(linked)||ready<current.get(linked).arrival)current.set(linked,{arrival:ready,path:[...path,{mode:'walk',origin:b,destination:linked,departure:arr,arrival:ready}],walking:rider.walking+duration});
          }
        }
      }
      const candidates=[...ends].flatMap(([s,walk])=>{
        const label=current.get(s);if(!label)return [];
        return [{arrival:label.arrival+walk,path:destination.placeType==='address'?[...label.path,this.walkingLeg(this.stops[s],destination,label.arrival,walk,{egress:true})]:label.path,walking:label.walking+walk}];
      }).filter(c=>c.arrival<=horizon).sort((a,b)=>a.arrival-b.arrival||a.walking-b.walking);
      if(candidates.length&&(!routeSequence||boardings===routeSequence.length)){const {arrival,path,walking}=candidates[0];results.push({departure:path[0].departure,arrival,duration:arrival-path[0].departure,wait:path[0].departure-seconds,transfers:boardings-1,walking,legs:path});}
      previous=current;
    }
    const options=[];
    for(const result of results)if(!options.some(r=>r.arrival<=result.arrival&&r.transfers<=result.transfers))options.push(result);
    return options.sort((a,b)=>a.arrival-b.arrival).map(r=>({...r,legs:r.legs.map(l=>{
      const from=l.from||this.stops[l.origin],to=l.to||this.stops[l.destination];
      const directions=l.directions||(l.mode==='walk'&&this.streets?this.streets.route(from,to,l.arrival-l.departure+5):null);
      return {...l,from,to,...(directions?{directions}:{} )};
    })}));
  }
  nearby({lat,lon,to,mode='all',now=aucklandNow(),feed={available:false},profile={}}){
    this.setProfile(profile);
    this.checkDate(now.date);
    if(!Number.isFinite(lat)||!Number.isFinite(lon))throw new Error('Choose a starting stop or use your location.');
    let stops=this.stops.map((stop,i)=>({stop,i,distance:metres(lat,lon,stop)})).filter(s=>s.stop.kind===0&&s.distance<=800&&(!this.profile.confirmedAccess||this.accessibleStop(s.i))).sort((a,b)=>a.distance-b.distance).slice(0,18);
    if(this.streets){
      const reachable=this.streets.reach({lat,lon},1200);
      stops=stops.flatMap(s=>{const snap=this.stopSnaps[s.i],seconds=snap?reachable.distance.get(snap.node):undefined;
        return seconds===undefined||seconds+snap.seconds>1200?[]:[{...s,walk:Math.ceil((seconds+snap.seconds)/60)}];});
    }else stops=stops.map(s=>({...s,walk:Math.ceil(s.distance*1.35/this.profile.pace/60)}));
    const ids=new Set(stops.map(s=>s.i)),ends=to?new Set(this.access(this.place(to),900,true).keys()):null;
    const connections=this.connections(now.date,now.seconds-1800,now.seconds+7200,mode==='all'?['bus','train','ferry']:[mode]);
    const onward=new Map();
    if(ends)for(const [,arr,ti,,b,,dropoff,offset]of connections)if(ends.has(b)&&dropoff===0){const key=`${ti}:${offset}`;onward.set(key,Math.max(onward.get(key)||0,arr));}
    const fresh=feed.available===true&&typeof feed.updated==='number'&&Number.isSafeInteger(feed.updated)&&Math.abs(Date.now()/1000-feed.updated)<=180;
    const metadata=fresh?tripStopMetadata(this.data,this.stops,new Set(connections.filter(c=>ids.has(c[3])).map(c=>this.data.trips[c[2]][0]))):new Map();
    const found=new Map(stops.map(s=>[s.i,[]])),seen=new Set();
    for(const [dep,,ti,a,,pickup,,offset]of connections){
      if(this.profile.confirmedAccess&&this.data.trips[ti][4]!==1)continue;
      if(!ids.has(a)||pickup!==0||(ends&&!(onward.get(`${ti}:${offset}`)>dep)))continue;
      const [trip,ri,,headsign]=this.data.trips[ti],dedup=`${trip}:${offset}:${a}:${dep}`;
      if(seen.has(dedup))continue;seen.add(dedup);
      let expected=dep,live=false;
      if(fresh){
        const run=metadata.get(trip);
        const prediction=departurePrediction(feed,{trip,routeId:this.data.routes[ri][0],serviceDate:compactDate(shiftDate(now.date,offset)),stop:this.stops[a],stopVisits:run?.visits.get(this.stops[a].id)||0,startTime:run?.startTime});
        if(['cancelled','skipped'].includes(prediction.status))continue;
        if(prediction.status==='predicted'){
          if(prediction.epoch){const at=aucklandNow(new Date(prediction.epoch*1000));expected=(Date.parse(at.date)-Date.parse(now.date))/86400000*86400+at.seconds;}
          else expected+=prediction.delay;
          live=true;
        }
      }
      if(expected<now.seconds||expected>now.seconds+7200)continue;
      found.get(a).push({trip,route:this.data.routes[ri][1]||this.data.routes[ri][2],headsign,mode:this.mode(ri),minutes:Math.ceil((expected-now.seconds)/60),departure:expected,scheduled:dep,live});
    }
    const result=stops.map(s=>({...s,distance:Math.round(s.distance),departures:found.get(s.i).sort((a,b)=>a.departure-b.departure).slice(0,5)})).filter(s=>s.departures.length);
    for(const s of result)for(const d of s.departures)d.tight=d.minutes<s.walk+2;
    result.sort((a,b)=>Math.min(...a.departures.filter(d=>!d.tight).map(d=>d.minutes),999)-Math.min(...b.departures.filter(d=>!d.tight).map(d=>d.minutes),999));
    return {stops:result,live:fresh,directOnly:!!ends,walkingSource:this.streets?'mapped':'estimated',message:fresh?'Live predictions where available.':'Scheduled departures · live updates are not connected.'};
  }
}
