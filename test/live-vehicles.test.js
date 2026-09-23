import test from 'node:test';
import assert from 'node:assert/strict';
import {vehiclePosition} from '../public/live-vehicles.js';
const run={trip:'t',routeId:'r',serviceDate:'20260923',startTime:'09:00:00'};
const entity=()=>({vehicle:{trip:{trip_id:'t',route_id:'r',start_date:'20260923',start_time:'09:00:00'},timestamp:990,position:{latitude:-36.85,longitude:174.76}}});
const match=(entities=[entity()],updated=1000)=>vehiclePosition({available:true,updated,entities},run,{now:1000});
test('vehicle matching requires one exact dated scheduled trip',()=>{
 assert.deepEqual(match(),{available:true,lat:-36.85,lon:174.76,updated:990,expires:1170});
 for(const change of [{trip_id:'other'},{start_date:'20260924'},{route_id:'other'},{start_time:'10:00:00'},{schedule_relationship:'CANCELED'},{schedule_relationship:'DUPLICATED'}]){
  const e=entity();Object.assign(e.vehicle.trip,change);assert.equal(match([e]).available,false);
 }
 assert.equal(match([entity(),entity()]).available,false);
 assert.equal(match([{...entity(),is_deleted:true}]).available,false);
});
test('feed and individual position must both be recent with valid coordinates',()=>{
 for(const updated of [0,819,1181,true,'bad'])assert.equal(match([entity()],updated).available,false);
 for(const timestamp of [undefined,0,819,1181,true,'bad']){
  const e=entity();e.vehicle.timestamp=timestamp;assert.equal(match([e]).available,false);
 }
 for(const position of [null,{latitude:91,longitude:174},{latitude:-36,longitude:181},{latitude:NaN,longitude:174},{latitude:'-36',longitude:174}]){
  const e=entity();e.vehicle.position=position;assert.equal(match([e]).available,false);
 }
});
