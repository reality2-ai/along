import {contextualAlerts} from '../public/live-context.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {aucklandWallEpoch,stopAlertContexts,journeyAlertContexts} from '../public/live-time.js';
test('Auckland wall times map to UTC independently of device timezone',()=>{
 assert.equal(aucklandWallEpoch('2026-09-23',32400),Date.parse('2026-09-22T21:00:00Z')/1000);
 assert.equal(aucklandWallEpoch('2026-12-01',32400),Date.parse('2026-11-30T20:00:00Z')/1000);
 assert.equal(aucklandWallEpoch('2026-09-23',90000),Date.parse('2026-09-23T13:00:00Z')/1000);
});
test('ambiguous, missing and malformed wall times are not guessed',()=>{
 assert.equal(aucklandWallEpoch('2026-09-27',9000),null);
 assert.equal(aucklandWallEpoch('2026-04-05',9000),null);
 assert.equal(aucklandWallEpoch('2026-02-30',0),null);
 assert.equal(aucklandWallEpoch('bad',0),null);
});
test('stop contexts bind each service to its own stop and instant',()=>{
 const rows=[{stop:{id:'platform'},routeId:'route',routeType:3,trip:'trip',serviceDate:'20260923',startTime:'09:00:00',departure:33000}];
 const contexts=stopAlertContexts({id:'station'},rows,{date:'2026-09-23',seconds:32400});
 assert.equal(contexts.length,2);assert.equal(contexts[0].stop_id,'station');assert.equal(contexts[0].end-contexts[0].start,7200);
 assert.equal(contexts[1].stop_id,'platform');assert.equal(contexts[1].start,contexts[1].end);assert.equal(contexts[1].trip.start_date,'20260923');
});

test('journey contexts retain intermediate stop intervals and the previous service date',()=>{
 const legs=[{mode:'walk',departure:0,arrival:30},{trip:'t',routeId:'r',routeType:3,serviceDate:'20260922',startTime:'24:10:00',departure:600,arrival:1800,calls:[{stopId:'a',arrival:600,departure:600},{stopId:'b',arrival:1200,departure:1260},{stopId:'c',arrival:1800,departure:1800}]}];
 const result=journeyAlertContexts(legs,'2026-09-23');assert.equal(result.length,4);
 assert.equal(result[0].trip.start_date,'20260922');assert.equal(result[0].end-result[0].start,1200);
 assert.equal(result[2].stop_id,'b');assert.equal(result[2].end-result[2].start,60);
 assert.deepEqual(journeyAlertContexts(legs.slice(2),'2026-09-23'),[]);
});

test('stop and journey alert contexts retain verified operator and direction, including zero',()=>{
 const row={trip:'t',serviceDate:'20260923',startTime:'09:00:00',routeId:'r',routeType:3,agencyId:'operator',directionId:0,departure:32400,arrival:33000,stop:{id:'s'}};
 const stop=stopAlertContexts({id:'s'},[row],{date:'2026-09-23',seconds:32400})[1];
 const leg=journeyAlertContexts([{...row,calls:[]}],'2026-09-23')[0];
 for(const context of [stop,leg]){
  assert.equal(context.agency_id,'operator');assert.equal(context.direction_id,0);assert.equal(context.trip.direction_id,0);
  const feed={available:true,updated:context.start,alerts:[
   {id:'right',informed_entity:[{agency_id:'operator',route_id:'r',direction_id:0}]},
   {id:'wrong-direction',informed_entity:[{agency_id:'operator',route_id:'r',direction_id:1}]},
   {id:'wrong-operator',informed_entity:[{agency_id:'other',route_id:'r',direction_id:0}]}
  ]};
  assert.deepEqual(contextualAlerts(feed,[context],{now:context.start}).map(a=>a.id),['right']);
  assert.equal(contextualAlerts(feed,[{...context,agency_id:undefined}],{now:context.start}).length,0);
 }
});
