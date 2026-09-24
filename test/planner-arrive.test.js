import test from 'node:test';
import assert from 'node:assert/strict';
import {Planner} from '../public/planner.js';
import {StreetGraph} from '../public/streets.js';
const network=(overrides={})=>({version:1,accessibilityVersion:1,metadata:{feed_start_date:'20260101',feed_end_date:'20261231'},stops:[['a','1','A',-36.85,174.76,'',0,1],['b','2','B',-36.85,174.77,'',0,1],['c','3','C',-36.85,174.80,'',0,1]],routes:[['r1','10','Bus',3],['r2','F','Ferry',4],['r3','W','Train',2]],trips:[['t1',0,'weekday','B',1],['t2',1,'weekday','C',1],['t3',2,'weekday','C',1]],calendar:[['weekday','20260101','20261231','1111100']],exceptions:[],transfers:[],connections:[0,0,1,28800,29400,0,0,2,0,2,28900,31200,0,0,1,1,2,29520,30120,0,0],...overrides});
const query={from:'a',to:'c',date:'2026-09-23',time:'08:22',timeMode:'arrive',modes:['bus','ferry','train']};
test('arrive by meets the exact deadline and uses latest feasible departure',()=>{
 const p=new Planner(network());const [j]=p.plan(query);assert.equal(j.departure,28800);assert.equal(j.arrival,30120);assert.equal(j.transfers,1);
 assert.deepEqual(p.plan({...query,time:'08:21'}),[]);
 const later=p.plan({...query,time:'08:40'});assert.equal(later[0].departure,28900);assert.equal(later[0].transfers,0);
 assert.equal(p.plan({...query,time:'08:40',timeMode:'leave'}).length,0);
});
test('transfer buffers and forbidden transfers are respected backwards',()=>{
 assert.deepEqual(new Planner(network({transfers:[['b','b',2,121]]})).plan(query),[]);
 assert.deepEqual(new Planner(network({transfers:[['b','b',3,0]]})).plan(query),[]);
});
test('pickup, dropoff, modes and accessibility still constrain arrive by',()=>{
 for(const index of [5,6,19,20]){const n=network();n.connections[index]=1;assert.deepEqual(new Planner(n).plan(query),[]);}
 assert.deepEqual(new Planner(network()).plan({...query,modes:['bus','train']}),[]);
 const n=network();n.trips[1][4]=0;assert.deepEqual(new Planner(n).plan({...query,profile:{confirmedAccess:true}}),[]);
});
test('same vehicle across intermediate stops needs no transfer buffer',()=>{
 const p=new Planner(network({connections:[0,0,1,28800,29400,0,1,0,1,2,29400,30000,1,0]}));
 const [j]=p.plan(query);assert.equal(j.transfers,0);assert.equal(j.departure,28800);assert.equal(j.legs[0].stops,2);
});
test('backwards route preference preserves forward service order',()=>{
 const p=new Planner(network()),preferredRoutes=[{mode:'bus',route:'10'},{mode:'ferry',route:'F'}];
 const j=p.plan({...query,time:'08:40',preferredRoutes});assert.equal(j[0].preferred,true);assert.equal(j[0].departure,28800);assert.equal(j[1].departure,28900);
 assert.ok(p.plan({...query,time:'08:40',preferredRoutes:[...preferredRoutes].reverse()}).every(j=>!j.preferred));
});
test('calendar, midnight and live service identity use the actual service day',()=>{
 const p=new Planner(network({connections:[0,0,2,85800,87000,0,0]}));
 const [j]=p.plan({...query,date:'2026-09-26',time:'00:10'});assert.equal(j.departure,-600);assert.equal(j.arrival,600);assert.equal(j.legs[0].serviceDate,'20260925');assert.equal(j.legs[0].startTime,'23:50:00');
 assert.deepEqual(j.legs[0].calls,[{stopId:'a',arrival:-600,departure:-600},{stopId:'c',arrival:600,departure:600}]);
 assert.deepEqual(new Planner(network({connections:[0,0,2,85800,87000,0,0],exceptions:[['weekday','20260925',2]]})).plan({...query,date:'2026-09-26',time:'00:10'}),[]);
 assert.throws(()=>p.plan({...query,date:'2027-01-01'}),/outside/);
});
function addressPlanner(){
 const p=new Planner(network());p.setStreets(new StreetGraph({version:1,accessibilityVersion:1,coords:[-36850000,174760000,-36850000,174760100,-36850000,174800000,-36850000,174800100],edges:[1,0,120,0,2,3,120,0],flags:[0,0],names:['One-way footpath'],addresses:[]}));
 return {p,from:{id:'home',name:'Home',placeType:'address',lat:-36.85,lon:174.7601},to:{id:'work',name:'Work',placeType:'address',lat:-36.85,lon:174.8001}};
}
test('arrival deadline includes directed first/last walks and boarding allowance',()=>{
 const {p,from,to}=addressPlanner();const q={...query,from,to,time:'08:24'};const [j]=p.plan(q);
 assert.deepEqual(j.legs.map(l=>l.mode),['walk','bus','ferry','walk']);assert.equal(j.departure,28620);assert.equal(j.arrival,30240);assert.equal(j.legs.at(-1).departure,30120);
 assert.deepEqual(p.plan({...q,time:'08:23'}),[]);
 assert.deepEqual(p.plan({...q,profile:{pace:0.8}}),[]);
 assert.throws(()=>p.plan({...q,from:to,to:from}),/No connected stops/);
});
test('walking-only arrival chooses its latest start and respects directed paths',()=>{
 const {p,from}=addressPlanner();const to={id:'near',name:'Near',placeType:'address',lat:-36.85,lon:174.76};
 const [j]=p.plan({...query,from,to});assert.equal(j.walkOnly,true);assert.equal(j.departure,30000);assert.equal(j.arrival,30120);
});
test('directed between-stop transfer and GTFS minimum remain binding',()=>{
 const n=network();n.stops.push(['d','4','Other wharf',-36.85,174.7701,'',0,1]);n.connections[15]=3;
 n.transfers=[['b','d',2,180]];n.connections[17]=29700;n.connections[18]=30120;
 let p=new Planner(n);assert.equal(p.plan(query)[0].departure,28800);
 n.transfers=[['d','b',2,180]];assert.deepEqual(new Planner(n).plan(query),[]);
 n.transfers=[['b','d',2,181]];assert.deepEqual(new Planner(n).plan(query),[]);
});
// Independent enumerator for a small two-leg timetable; the oracle does not use
// reverse labels or the planner's result reconstruction.
test('latest departure matches exhaustive feasible direct/two-leg combinations',()=>{
 for(let sample=0;sample<35;sample++){
  const n=network(),rows=[],direct=[],first=[],second=[];
  n.trips=[];
  const add=(route,a,b,dep,arr,list)=>{const t=n.trips.length;n.trips.push(['trip'+t,route,'weekday','C',1]);rows.push([t,a,b,dep,arr,0,0]);list.push({dep,arr});};
  for(let i=0;i<4;i++){add(0,0,1,28000+i*120+sample*7,28200+i*120+sample*7,first);add(1,1,2,28330+i*150+sample*3,28530+i*150+sample*3,second);add(2,0,2,28010+i*90+sample*5,28600+i*170+sample*5,direct);}
  n.connections=rows.sort((a,b)=>a[3]-b[3]).flat();const deadline=28800;
  const feasible=[...direct.filter(j=>j.arr<=deadline).map(j=>j.dep),...first.filter(a=>second.some(b=>b.dep>=a.arr+120&&b.arr<=deadline)).map(j=>j.dep)];
  const options=new Planner(n).plan({...query,time:'08:00'});
  assert.equal(Math.max(...options.map(j=>j.departure)),Math.max(...feasible));assert.ok(options.every(j=>j.arrival<=deadline));
 }
});
test('reverse street transfers respect direction and mapped barriers',()=>{
 const make=(reverse=false,steps=false)=>{
  const n=network();n.stops.push(['d','4','Other wharf',-36.85,174.7701,'',0,1]);n.connections[15]=3;n.connections[17]=29700;n.connections[18]=30120;
  const p=new Planner(n);p.setStreets(new StreetGraph({version:1,accessibilityVersion:1,coords:[-36850000,174770000,-36850000,174770100],edges:reverse?[1,0,180,0]:[0,1,180,0],flags:[steps?1:0],names:['Wharf connection'],addresses:[]}));return p;
 };
 const [j]=make().plan(query);assert.deepEqual(j.legs.map(l=>l.mode),['bus','walk','ferry']);assert.equal(j.legs[1].from.id,'b');assert.equal(j.legs[1].to.id,'d');
 assert.deepEqual(make(true).plan(query),[]);assert.deepEqual(make(false,true).plan({...query,profile:{avoidSteps:true}}),[]);
});
