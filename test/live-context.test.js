import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesSelector,contextualAlerts} from '../public/live-context.js';
const context={agency_id:'AT',route_id:'70',route_type:3,direction_id:0,stop_id:'A',
  trip:{trip_id:'t1',route_id:'70',start_date:'20260923',start_time:'09:00:00'},start:1000,end:1100};
const alert=(selectors,extra={})=>({title:'Test alert',informed_entity:selectors,...extra});
const feed=alerts=>({available:true,updated:1000,alerts});
const select=(alerts,contexts=[context],now=1000)=>contextualAlerts(feed(alerts),contexts,{now});
test('selectors AND restrictions within a context and OR separate selectors',()=>{
  assert.equal(matchesSelector({route_id:'70',stop_id:'A'},context),true);
  assert.equal(matchesSelector({route_id:'70',stop_id:'B'},context),false);
  assert.equal(matchesSelector({route_type:'3',direction_id:0,route_id:'70'},context),true);
  assert.equal(matchesSelector({direction_id:0},context),false);
  assert.equal(matchesSelector({route_id:'70',future_restriction:'x'},context),false);
  assert.equal(matchesSelector({},context),false);
  assert.equal(matchesSelector({agency_id:'other'},context),false);
  assert.equal(select([alert([{route_id:'other'},{stop_id:'A'}])]).length,1);
  assert.equal(select([alert([{route_id:'70',stop_id:'B'}])],
    [context,{...context,route_id:'other',stop_id:'B'}]).length,0);
});
test('trip alerts respect date, start time and missing identity',()=>{
  assert.equal(matchesSelector({trip:{trip_id:'t1'}},context),true);
  for(const trip of [{trip_id:'t1',start_date:'20260924'},
    {trip_id:'t1',start_time:'10:00:00'},{trip_id:'t2'},{unknown:'value'},{}])
    assert.equal(matchesSelector({trip},context),false);
  assert.equal(matchesSelector({trip:{trip_id:'t1',schedule_relationship:3}},context),true);
  assert.equal(matchesSelector({trip:{trip_id:'t1'}},{...context,trip:{trip_id:'t1'}}),false);
});
test('freshness and half-open alert periods exclude stale, future and expired advice',()=>{
  const a=alert([{route_id:'70'}]);
  assert.equal(select([a]).length,1);
  assert.equal(select([a],[context],1181).length,0);
  assert.equal(select([a],[context],819).length,0);
  for(const period of [{start:1100},{end:1000},{start:1200,end:1100},{start:'bad'},{start:null}])
    assert.equal(select([{...a,active_period:[period]}]).length,0);
  assert.equal(select([{...a,active_period:[{start:900,end:1001}]}]).length,1);
  assert.equal(select([{...a,active_period:[{start:900,end:1001}]}],[{...context,start:1001,end:1100}]).length,0);
  assert.equal(select([{...a,active_period:'invalid'}]).length,0);
  assert.equal(select([{...a,communication_period:null}]).length,0);
  assert.equal(select([{...a,impact_period:null}]).length,0);
  assert.equal(select([{...a,active_period:[{end:500},{start:900}]}]).length,1);
});
test('future impact may be shown during communication only for affected travel',()=>{
  const a=alert([{stop_id:'A'}],{communication_period:[{start:900,end:1300}],impact_period:[{start:1200,end:1300}]});
  assert.equal(select([a]).length,0);
  assert.equal(select([a],[{...context,start:1200,end:1250}]).length,1);
  assert.equal(select([a],[{...context,start:1200,end:1250}],800).length,0);
});
test('no context or unavailable/malformed feeds produce no journey advice; inputs unchanged',()=>{
  const data=feed([alert([{stop_id:'A'}]),alert([]),null]);
  const before=JSON.stringify(data);
  assert.equal(contextualAlerts(data,[],{now:1000}).length,0);
  assert.equal(contextualAlerts({...data,available:false},[context],{now:1000}).length,0);
  assert.equal(contextualAlerts({...data,updated:true},[context],{now:1000}).length,0);
  assert.equal(contextualAlerts(data,[context],{now:1000}).length,1);
  assert.equal(JSON.stringify(data),before);
});
