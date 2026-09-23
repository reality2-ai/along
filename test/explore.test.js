import test from 'node:test';
import assert from 'node:assert/strict';
import {Planner} from '../public/planner.js';
import {findRoutes,routeDetails,stopDetails} from '../public/explore.js';
function fixture(){return new Planner({version:1,stops:[['a','1','Symonds Street',-36.85,174.76,'',0],['b','2','Queen Street',-36.84,174.76,'',0],['c','3','Other branch',-36.83,174.77,'',0]],routes:[['r','70','City',3,'']],trips:[['one',0,'weekday','City'],['two',0,'weekday','City'],['three',0,'weekday','Other'],['inactive',0,'weekend','Other']],calendar:[['weekday','20260101','20261231','1111100'],['weekend','20260101','20261231','0000011']],exceptions:[],transfers:[],connections:[0,0,1,28800,29400,0,0,1,0,1,32400,33000,0,0,2,0,2,33000,33600,1,0,3,0,2,34000,35000,0,0]});}
test('route exploration retains branches, active service dates, complete stops and requested trip',()=>{
 const p=fixture();assert.equal(findRoutes(p,'70')[0].id,'r');
 const r=routeDetails(p,{routeId:'r',tripId:'one',date:'2026-09-23',time:'08:30'},{trips:{one:'shape',two:'shape'},shapes:{shape:[[1,2],[3,4]]}});
 assert.equal(r.variants.length,2);assert.equal(r.variants[0].selectedTrip,'one');assert.equal(r.variants[0].runs.length,2);assert.equal(r.variants[0].stops.at(-1).time,29400);assert.deepEqual(r.variants[0].shape,[[1,2],[3,4]]);
 assert.equal(routeDetails(p,{routeId:'r',date:'2026-09-26'}).variants.length,1);
});
test('stop times exclude unavailable pickup and include only upcoming active services',()=>{
 const result=stopDetails(fixture(),{id:'a',now:{date:'2026-09-23',seconds:30000}});assert.deepEqual(result.map(r=>r.trip),['two']);assert.equal(result[0].serviceDate,'20260923');assert.equal(result[0].startTime,'09:00:00');assert.equal(result[0].stopVisits,1);
});

test('original boarding sequence reaches journey legs and stop departures',()=>{
 const p=fixture();p.data.metadata={};p.data.routeAgencies=['operator'];p.data.tripDirections=[1,0,1,null];p.data.connectionSequences=[10,30,80,120];
 const rows=stopDetails(p,{id:'a',now:{date:'2026-09-23',seconds:30000}});
 assert.equal(rows[0].stopSequence,30);assert.equal(rows[0].agencyId,'operator');assert.equal(rows[0].directionId,0);
 const journeys=p.plan({from:'a',to:'b',date:'2026-09-23',time:'08:30',modes:['bus']});
 const leg=journeys[0].legs.find(l=>l.trip);
 assert.equal(leg.stopSequence,30);assert.equal(leg.agencyId,'operator');assert.equal(leg.directionId,0);
});
