import test from 'node:test';
import assert from 'node:assert/strict';
import {Planner,aucklandNow} from '../public/planner.js';
import {readPreferences,recordJourney,suggestions,writePreferences} from '../public/preferences.js';

function network(overrides={}) {
  return {version:1,metadata:{feed_start_date:'20260101',feed_end_date:'20261231'},
    stops:[['a','1','Alpha',-36.85,174.76,'',0],['b','2','Beta',-36.851,174.76,'',0],['c','3','Waitematā',-36.852,174.76,'',0]],
    routes:[['r1','10','Ten',3,''],['r2','20','Twenty',3,''],['r3','30','Thirty',3,'']],
    trips:[['t1',0,'weekday','Beta'],['t2',1,'weekday','Waitematā'],['t3',2,'weekday','Waitematā']],
    calendar:[['weekday','20260101','20261231','1111100']],exceptions:[],transfers:[],
    connections:[0,0,1,28800,29400,0,0,2,0,2,28900,31200,0,0,1,1,2,29520,30120,0,0],...overrides};
}
const query={from:'a',to:'c',date:'2026-09-22',time:'07:59',modes:['bus']};
test('compares faster transfer with slower direct service',()=>{
  const options=new Planner(network()).plan(query);
  assert.equal(options.length,2);assert.equal(options[0].arrival,30120);assert.equal(options[0].transfers,1);
  assert.equal(options[1].arrival,31200);assert.equal(options[1].transfers,0);
});
test('cannot board a missed connection or a disallowed pickup',()=>{
  const n=network();n.connections[17]=29460;
  assert.equal(new Planner(n).plan(query).length,1);
  n.connections[12]=1;
  assert.deepEqual(new Planner(n).plan(query),[]);
});
test('calendar exceptions remove services and weekends are not weekdays',()=>{
  assert.deepEqual(new Planner(network()).plan({...query,date:'2026-09-26'}),[]);
  assert.deepEqual(new Planner(network({exceptions:[['weekday','20260922',2]]})).plan(query),[]);
  assert.equal(new Planner(network({exceptions:[['weekday','20260926',1]]})).plan({...query,date:'2026-09-26'}).length,2);
});
test('previous service day 24-hour times remain available after midnight',()=>{
  const n=network({connections:[0,0,2,87000,87600,0,0]});
  const result=new Planner(n).plan({...query,date:'2026-09-26',time:'00:05'});
  assert.equal(result[0].departure,600);assert.equal(result[0].arrival,1200);
  assert.equal(result[0].legs[0].stopVisits,1);assert.equal(result[0].legs[0].serviceDate,'20260925');assert.equal(result[0].legs[0].startTime,'24:10:00');
  assert.deepEqual(result[0].legs[0].calls,[{stopId:'a',arrival:600,departure:600},{stopId:'c',arrival:1200,departure:1200}]);
});
test('mode filters, identical stops and out-of-feed dates are handled',()=>{
  const p=new Planner(network());assert.deepEqual(p.plan({...query,modes:['train']}),[]);
  assert.throws(()=>p.plan({...query,to:'a'}),/different/);
  assert.throws(()=>p.plan({...query,date:'2027-01-01'}),/outside/);
  assert.throws(()=>p.plan({...query,modes:[]}),/mode/);
});
test('staying on a bus does not require a new transfer buffer',()=>{
  const n=network({connections:[0,0,1,28800,29400,0,0,0,1,2,29400,30000,0,0]});
  const result=new Planner(n).plan(query);assert.equal(result[0].transfers,0);assert.equal(result[0].legs[0].stops,2);
});
test('a forbidden transfer does not permit changing buses',()=>{
  const n=network({transfers:[['b','b',3,0]]});assert.equal(new Planner(n).plan(query).length,1);
});
test('nearby results compare lines and filter direct services',()=>{
  const p=new Planner(network());const args={lat:-36.85,lon:174.76,now:{date:'2026-09-22',seconds:28740}};
  let result=p.nearby(args);assert.equal(result.stops.find(s=>s.stop.id==='a').departures.length,2);
  result=p.nearby({...args,to:'c'});assert.equal(result.stops.find(s=>s.stop.id==='a').departures.length,1);assert.equal(result.directOnly,true);
});
test('fresh cancellations remove departures; stale feeds do not masquerade as live',()=>{
  const p=new Planner(network()),args={lat:-36.85,lon:174.76,now:{date:'2026-09-22',seconds:28740}};
  const feed={available:true,updated:Math.floor(Date.now()/1000),entities:[{trip_update:{trip:{trip_id:'t1',start_date:'20260922',schedule_relationship:3}}}]};
  const live=p.nearby({...args,feed});assert.equal(live.stops.find(s=>s.stop.id==='a').departures.length,1);
  const stale=p.nearby({...args,feed:{...feed,updated:1}});assert.equal(stale.live,false);assert.equal(stale.stops.find(s=>s.stop.id==='a').departures.length,2);
});
test('search accepts Māori names without a macron',()=>assert.equal(new Planner(network()).search('Waitemata')[0].id,'c'));
test('Auckland clock is independent of browser timezone',()=>assert.equal(aucklandNow(new Date('2026-09-22T20:00:00Z')).time,'08:00'));
test('learned routes need repeat use; suggestions stay optional',()=>{
  const from={id:'a'},to={id:'b'},context={hour:8,day:2,timestamp:10};
  let prefs={learning:true,journeys:[]};prefs=recordJourney(prefs,from,to,context);assert.equal(suggestions(prefs,context).length,0);
  prefs=recordJourney(prefs,from,to,context);assert.equal(suggestions(prefs,context).length,1);
  prefs.learning=false;assert.equal(recordJourney(prefs,from,{id:'c'},context).journeys.length,1);assert.equal(suggestions(prefs,context).length,0);
  prefs.journeys[0].saved=true;assert.equal(suggestions(prefs,context).length,1);
});
test('unavailable or corrupt browser storage does not break planning',()=>{
  assert.deepEqual(readPreferences({getItem:()=>'{broken'}),{learning:true,journeys:[]});
  assert.equal(writePreferences({}, {setItem:()=>{throw new Error('Full');}}),false);
});


test('saved sequence is searched even when a faster direct route dominates it',()=>{
 const n=network();n.connections[11]=29000;
 const p=new Planner(n);assert.equal(p.plan(query).length,1);
 const results=p.plan({...query,preferredRoutes:[{mode:'bus',route:'10'},{mode:'bus',route:'20'}]});
 assert.equal(results[0].preferred,true);assert.deepEqual(results[0].legs.filter(l=>l.mode!=='walk').map(l=>l.route),['10','20']);
 assert.equal(results[1].legs[0].route,'30');assert.ok(results[0].arrival>results[1].arrival);
});
test('saved sequence respects ordering, departures, modes and forbidden transfers',()=>{
 const p=new Planner(network()),pref=[{mode:'bus',route:'10'},{mode:'bus',route:'20'}];
 assert.ok(p.plan({...query,preferredRoutes:pref}).some(j=>j.preferred));
 assert.ok(p.plan({...query,preferredRoutes:[...pref].reverse()}).every(j=>!j.preferred));
 assert.ok(p.plan({...query,time:'08:01',preferredRoutes:pref}).every(j=>!j.preferred));
 assert.deepEqual(p.plan({...query,modes:['train'],preferredRoutes:pref}),[]);
 assert.ok(new Planner(network({transfers:[['b','b',3,0]]})).plan({...query,preferredRoutes:pref}).every(j=>!j.preferred));
});
test('saved preferences persist service numbers and keep legacy saved endpoints usable',()=>{
 const entry={from:{id:'a'},to:{id:'c'},count:2,hours:Array(24).fill(0),days:Array(7).fill(0),saved:true};
 let raw='';const storage={getItem:()=>raw,setItem:(key,value)=>raw=value};
 writePreferences({learning:false,journeys:[entry]},storage);assert.equal(readPreferences(storage).journeys[0].saved,true);assert.equal(readPreferences(storage).journeys[0].savedRoutes,null);
 entry.savedRoutes=[{mode:'bus',route:'10'},{mode:'train',route:'S-C'}];
 writePreferences({learning:false,journeys:[entry]},storage);assert.deepEqual(readPreferences(storage).journeys[0].savedRoutes,entry.savedRoutes);
 entry.savedRoutes=[{mode:'airplane',route:'10'}];writePreferences({journeys:[entry]},storage);assert.equal(readPreferences(storage).journeys[0].savedRoutes,null);
});

test('live updates require an unambiguous trip instance and matching optional route',()=>{
  const p=new Planner(network()),args={lat:-36.85,lon:174.76,now:{date:'2026-09-22',seconds:28740}};
  const item=trip=>({trip_update:{trip:{trip_id:'t1',schedule_relationship:3,...trip}}});
  const cases=[
    [item({})], [item({start_date:'20260921'})],
    [item({start_date:'20260922',route_id:'other-route'})],
    [item({start_date:'20260922'}),item({start_date:'20260922'})]
  ];
  for(const entities of cases){
    const result=p.nearby({...args,feed:{available:true,updated:Math.floor(Date.now()/1000),entities}});
    const departures=result.stops.find(s=>s.stop.id==='a').departures;
    assert.equal(departures.length,2);assert.equal(departures.some(d=>d.live),false);
  }
  const matched=p.nearby({...args,feed:{available:true,updated:Math.floor(Date.now()/1000),entities:[item({start_date:'20260922',route_id:'r1'})]}});
  assert.equal(matched.stops.find(s=>s.stop.id==='a').departures.length,1);
});

test('malformed live event numbers retain scheduled departure times',()=>{
  const p=new Planner(network()),args={lat:-36.85,lon:174.76,now:{date:'2026-09-22',seconds:28740}};
  for(const departure of [{delay:'not-a-number'},{time:'not-a-number'},{delay:Infinity}]){
    const feed={available:true,updated:Math.floor(Date.now()/1000),entities:[{trip_update:{trip:{trip_id:'t1',start_date:'20260922'},stop_time_update:[{stop_id:'a',departure}]}}]};
    const result=p.nearby({...args,feed}).stops.find(s=>s.stop.id==='a').departures.find(d=>d.trip==='t1');
    assert.equal(result.departure,28800);assert.equal(result.live,false);
  }
});

test('nearby retains schedules for no-data, ambiguous stops and invalid event values',()=>{
 const args={lat:-36.85,lon:174.76,now:{date:'2026-09-22',seconds:28740}};
 const makeFeed=event=>({available:true,updated:Math.floor(Date.now()/1000),entities:[{trip_update:{trip:{trip_id:'t1',start_date:'20260922'},stop_time_update:[{stop_id:'a',...event}]}}]});
 for(const event of [{schedule_relationship:'NO_DATA',departure:{delay:60}},{schedule_relationship:3,departure:{delay:60}},{departure:{delay:true}},{departure:{time:1e20}}]){
  const result=new Planner(network()).nearby({...args,feed:makeFeed(event)}).stops.find(s=>s.stop.id==='a').departures.find(d=>d.trip==='t1');
  assert.equal(result.departure,28800);assert.equal(result.live,false);
 }
 const n=network();n.connections.push(0,1,0,30000,30600,0,0);
 const result=new Planner(n).nearby({...args,feed:makeFeed({departure:{delay:60}})}).stops.find(s=>s.stop.id==='a').departures.find(d=>d.trip==='t1');
 assert.equal(result.departure,28800);assert.equal(result.live,false);
});
