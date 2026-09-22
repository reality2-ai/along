import test from 'node:test';
import assert from 'node:assert/strict';
import {StreetGraph} from '../public/streets.js';
import {Planner} from '../public/planner.js';

function graph(){return new StreetGraph({version:1,accessibilityVersion:1,coords:[-36850000,174760000,-36850000,174762000,-36848000,174762000,-36848000,174760000],edges:[0,1,100,0,1,0,100,0,1,2,100,1,2,1,100,1,0,3,150,2,3,0,150,2,3,2,150,2,2,3,150,2],flags:[0,0,1,1,0,0,0,0],names:['Queen Street','Steps','Level footpath'],addresses:[['x','1 Queen Street, Auckland Central',-36.85,174.76,'Queen Street'],['y','2 Queen Street, Auckland Central',-36.848,174.762,'']]});}
test('street paths respect direction and avoid mapped steps when requested',()=>{
  const g=graph(),from={lat:-36.85,lon:174.76},to={lat:-36.848,lon:174.762};
  assert.equal(g.route(from,to,600).seconds,200);
  g.profile={avoidSteps:true,pace:1.25};assert.equal(g.route(from,to,600).seconds,300);
  assert.ok(g.route(from,to,600).steps.every(s=>s.name!=='Steps'));
  g.profile={avoidSteps:true,pace:0.8};assert.ok(g.route(from,to,600).seconds>300);
});
test('unconnected places and over-limit walks never become straight-line journeys',()=>{
  const g=graph();assert.equal(g.route({lat:-36.85,lon:174.76},{lat:-37,lon:175},900),null);
  assert.equal(g.route({lat:-36.85,lon:174.76},{lat:-36.848,lon:174.762},50),null);
});
test('a one-way walking path can end at a sink without allowing reverse travel',()=>{
  const g=new StreetGraph({version:1,coords:[-36850000,174760000,-36850000,174765000],edges:[0,1,400,0],names:['One way'],addresses:[]});
  const a={lat:-36.85,lon:174.76},b={lat:-36.85,lon:174.765};
  assert.equal(g.route(a,b,600).seconds,400);
  assert.equal(g.route(b,a,600),null);
});
test('nearby catchability respects mapped barriers and selected walking pace',()=>{
  const g=graph();
  const p=new Planner({version:1,accessibilityVersion:1,metadata:{},stops:[['s','1','Next stop',-36.848,174.762,'',0]],routes:[['r','BUS','Bus',3]],trips:[['t',0,'d','City']],calendar:[['d','20260101','20261231','1111111']],exceptions:[],transfers:[],connections:[0,0,0,29280,29300,0,0]});
  p.setStreets(g);
  const query={lat:-36.85,lon:174.76,now:{date:'2026-09-23',seconds:28800}};
  const usual=p.nearby(query),slower=p.nearby({...query,profile:{avoidSteps:true,pace:0.8}});
  assert.equal(usual.walkingSource,'mapped');
  assert.equal(usual.stops[0].walk,4);
  assert.equal(usual.stops[0].departures[0].tight,false);
  assert.equal(slower.stops[0].walk,8);
  assert.equal(slower.stops[0].departures[0].tight,true);
  assert.equal(p.nearby({...query,lat:-36.856}).stops.length,0);
});
test('offline address matching handles street abbreviations and suburb disambiguation',()=>{
  const results=graph().search('1 Queen St Auckland');assert.equal(results.length,1);assert.equal(results[0].placeType,'address');
  assert.equal(graph().search('99 Queen Street').length,0);
});
test('address endpoints combine bus, ferry and train with first/last walks',()=>{
  const stops=[['a','1','Bus stop',-36.85,174.76,'',0,1],['b','2','Wharf',-36.85,174.77,'',0,1],['c','3','Station',-36.85,174.80,'',0,1],['d','4','Destination stop',-36.85,174.84,'',0,1]];
  const network={version:1,accessibilityVersion:1,metadata:{feed_start_date:'20260101',feed_end_date:'20261231'},stops,routes:[['r1','BUS',null,3],['r2','FERRY',null,4],['r3','TRAIN',null,2]],trips:[['t1',0,'daily','Wharf',1],['t2',1,'daily','Station',1],['t3',2,'daily','Destination',1]],calendar:[['daily','20260101','20261231','1111111']],exceptions:[],transfers:[],connections:[0,0,1,28800,29400,0,0,1,1,2,29600,30200,0,0,2,2,3,30400,31000,0,0]};
  const g=new StreetGraph({version:1,accessibilityVersion:1,coords:[-36850000,174760000,-36850000,174760100,-36850000,174840000,-36850000,174840100],edges:[0,1,10,0,1,0,10,0,2,3,10,0,3,2,10,0],flags:[0,0,0,0],names:['Footpath'],addresses:[]});
  const planner=new Planner(network);planner.setStreets(g);
  const from={id:'home',name:'Start address',placeType:'address',lat:-36.85,lon:174.7601};
  const to={id:'work',name:'End address',placeType:'address',lat:-36.85,lon:174.8401};
  const query={from,to,date:'2026-09-23',time:'07:55',modes:['bus','ferry','train']};
  const results=planner.plan(query);assert.equal(results.length,1);
  assert.deepEqual(results[0].legs.map(l=>l.mode),['walk','bus','ferry','train','walk']);
  assert.equal(results[0].legs[0].from.name,'Start address');assert.equal(results[0].legs.at(-1).to.name,'End address');
  assert.deepEqual(planner.plan({...query,modes:['bus','train']}),[]);
  assert.equal(planner.plan({...query,profile:{confirmedAccess:true}}).length,1);
  planner.data.trips[1][4]=0;assert.deepEqual(planner.plan({...query,profile:{confirmedAccess:true}}),[]);
});
