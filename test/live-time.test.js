import test from 'node:test';
import assert from 'node:assert/strict';
import {aucklandWallEpoch,stopAlertContexts} from '../public/live-time.js';
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
