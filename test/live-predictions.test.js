import test from 'node:test';
import assert from 'node:assert/strict';
import {departurePrediction} from '../public/live-predictions.js';
const d={trip:'t',serviceDate:'20260923',routeId:'r',startTime:'09:00:00',stop:{id:'s'},stopVisits:1};
const entity=(trip={},event={})=>({trip_update:{trip:{trip_id:'t',start_date:'20260923',...trip},stop_time_update:[{stop_id:'s',departure:{delay:60},...event}]}});
const predict=(entities=[entity()],dep=d)=>departurePrediction({available:true,updated:1000,entities},dep,{now:1000});
test('matches a dated departure and preserves schedule identity',()=>{
 assert.deepEqual(predict(),{status:'predicted',delay:60,updated:1000});
 assert.equal(predict([entity({}, {departure:{time:'1200',delay:10}})]).epoch,1200);
 for(const trip of [{start_date:'20260924'},{route_id:'other'},{start_time:'10:00:00'},{trip_id:'other'}])assert.equal(predict([entity(trip)]).status,'scheduled');
 assert.equal(predict([entity(),entity()]).status,'scheduled');
 assert.equal(predict([entity()],{...d,serviceDate:''}).status,'scheduled');
});
test('cancellation, skipped stop and no-data relationships stay distinct',()=>{
 assert.equal(predict([entity({schedule_relationship:'CANCELED'})]).status,'cancelled');
 assert.equal(predict([entity({}, {schedule_relationship:'SKIPPED'})]).status,'skipped');
 for(const relationship of ['NO_DATA',2,'UNSCHEDULED',3])assert.equal(predict([entity({}, {schedule_relationship:relationship})]).status,'scheduled');
 assert.equal(predict([entity({schedule_relationship:'REPLACEMENT'})]).status,'scheduled');
});
test('loop visits, duplicate stop events and changed assignments are not guessed',()=>{
 assert.equal(predict([entity()],{...d,stopVisits:2}).status,'scheduled');
 const e=entity();e.trip_update.stop_time_update.push(e.trip_update.stop_time_update[0]);assert.equal(predict([e]).status,'scheduled');
 assert.equal(predict([entity({}, {stop_time_properties:{assigned_stop_id:'other'}})]).status,'scheduled');
});
test('invalid numeric events and old feeds keep scheduled times',()=>{
 for(const departure of [{delay:true},{delay:''},{delay:'bad'},{time:null},{time:1e16},{time:'invalid',delay:5}])assert.equal(predict([entity({}, {departure})]).status,'scheduled');
 assert.equal(predict([entity({}, {departure:{delay:-60}})]).delay,-60);
 assert.equal(departurePrediction({available:true,updated:1000,entities:[entity()]},d,{now:1181}).status,'scheduled');
});

test('fresh feed headers do not renew stale trip progress predictions',()=>{
 for(const timestamp of [819,1181,0,true,null,'bad']){
  const e=entity();e.trip_update.timestamp=timestamp;
  assert.equal(predict([e]).reason,'stale-trip');
 }
 const e=entity();e.trip_update.timestamp='850';assert.equal(predict([e]).updated,850);
 assert.equal(departurePrediction({available:true,updated:1000,entities:[e]},d,{now:1031}).reason,'stale-trip');
 const cancelled=entity({schedule_relationship:'CANCELED'});cancelled.trip_update.timestamp=1;
 assert.equal(predict([cancelled]).status,'cancelled');
});
