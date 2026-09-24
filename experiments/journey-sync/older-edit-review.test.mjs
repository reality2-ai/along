import test from 'node:test';
import assert from 'node:assert/strict';
import {createOlderEditReview} from './older-edit-review.mjs';
import {changeGenerationJourney} from './generation-state.mjs';
import {projectJourney,journeyId,JourneyCapacityError} from './state.mjs';
const group='a'.repeat(64),actor='b'.repeat(64),version={generation:1,checkpoint:'c'.repeat(64)};
const point=id=>({id,name:id,lat:-36,lon:174});
const value=(id,route='70')=>projectJourney({from:point('Home'),to:point(id),savedRoutes:[{mode:'bus',route}]});
const stateOf=values=>values.reduce((s,v)=>changeGenerationJourney(s,actor,journeyId(v),v),
  {format:2,group,...version,clock:0,journeys:[]});
const raw=(values,current=false,extra={})=>JSON.stringify({learning:false,...extra,journeys:values.map(v=>({...v,saved:true,count:7})),
  journeySync:{format:1,group,pending:[],...(current?{version}: {})}});
const input=(source,older,local)=>({current:stateOf(local),sourceRaw:raw(source),olderRaw:raw(older),currentRaw:raw(local,true),actor});
test('older review isolates changes since the baseline and preserves unrelated newer choices',async()=>{
  const source=[value('Work'),value('Library')],older=[value('Work','75'),value('Library')],local=[value('Work','80'),value('Library','90'),value('New')];
  const args=input(source,older,local),before=structuredClone(args),review=await createOlderEditReview(args);
  assert.equal(review.differences.length,1);assert.equal(review.differences[0].current.savedRoutes[0].route,'80');
  assert.equal(review.differences[0].older.savedRoutes[0].route,'75');
  const keep=review.resolve([{id:journeyId(value('Work')),use:'current'}]);assert.equal(keep.changes.length,0);
  const use=review.resolve([{id:journeyId(value('Work')),use:'older'}]);
  assert.equal(use.saved.find(v=>v.to.id==='Library').savedRoutes[0].route,'90');assert.ok(use.saved.some(v=>v.to.id==='New'));
  assert.deepEqual(args,before);
  review.differences[0].older.savedRoutes[0].route='99';
  assert.equal(review.resolve([{id:journeyId(value('Work')),use:'older'}]).changes[0].value.savedRoutes[0].route,'75');
});
test('deletions and additions require explicit choices; history-only edits do not become shared data',async()=>{
  const args=input([value('Work')],[value('New')],[value('Work')]);
  const review=await createOlderEditReview(args);assert.equal(review.differences.length,2);
  assert.throws(()=>review.resolve([]));assert.throws(()=>review.resolve(review.differences.map(d=>({id:d.id,use:'automatic'}))));
  const decision=review.resolve(review.differences.map(d=>({id:d.id,use:'older'})));
  assert.deepEqual(decision.saved,[value('New')]);
  const history=input([value('Work')],[value('Work')],[value('Work')]);
  history.olderRaw=raw([value('Work')],false,{learning:true});
  assert.equal((await createOlderEditReview(history)).differences.length,0);
});
test('stale inputs change review identity; inconsistent journals and unmerged current data refuse',async()=>{
  const args=input([value('Work')],[value('Work','75')],[value('Work','80')]);
  const first=await createOlderEditReview(args);
  assert.notEqual((await createOlderEditReview({...args,olderRaw:args.olderRaw+' '})).id,first.id);
  const bad=JSON.parse(args.olderRaw);bad.journeySync.pending=[{id:crypto.randomUUID(),changes:[{id:journeyId(value('Work')),value:null}]}];
  await assert.rejects(createOlderEditReview({...args,olderRaw:JSON.stringify(bad)}));
  await assert.rejects(createOlderEditReview({...args,currentRaw:raw([value('Work','99')],true)}));
  await assert.rejects(createOlderEditReview({...args,olderRaw:null}));
  await assert.rejects(createOlderEditReview({...args,olderRaw:raw([value('Work','75'),value('Work','99')])}));
  bad.journeySync.pending[0].changes[0].value=value('Work','75');
  assert.equal((await createOlderEditReview({...args,olderRaw:JSON.stringify(bad)})).differences.length,1);
});
test('capacity overflow refuses the selected combination without trimming',async()=>{
  const local=Array.from({length:256},(_,n)=>value('Place '+n));
  const review=await createOlderEditReview(input([], [value('Extra')],local));
  assert.throws(()=>review.resolve([{id:journeyId(value('Extra')),use:'older'}]),JourneyCapacityError);
  assert.equal(review.resolve([{id:journeyId(value('Extra')),use:'current'}]).saved.length,256);
});
