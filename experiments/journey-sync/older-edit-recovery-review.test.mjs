import test from 'node:test';
import assert from 'node:assert/strict';
import {createOlderEditRecoveryReview} from './older-edit-recovery-review.mjs';
import {changeGenerationJourney} from './generation-state.mjs';
import {projectJourney,journeyId} from './state.mjs';
const group='a'.repeat(64),actor='b'.repeat(64),version={generation:1,checkpoint:'c'.repeat(64)};
const point=id=>({id,name:id,lat:-36,lon:174});
const value=route=>projectJourney({from:point('Home'),to:point('Work'),savedRoutes:[{mode:'bus',route}]});
const state=changeGenerationJourney({format:2,group,...version,clock:0,journeys:[]},actor,journeyId(value('75')),value('75'));
const application={format:1,member:actor,reviewId:'d'.repeat(64),after:state,outputRaw:'retained original output',olderRaw:'retained older input',complete:false};
const raw=(route='80',pending=[])=>JSON.stringify({learning:true,accessibility:{stepFree:true},journeys:[{...value(route),saved:true,count:11,last:42}],journeySync:{format:1,group,version,pending}});
const input=currentRaw=>({application,current:state,currentRaw,actor});
test('explicit recovery choices preserve newer history/preferences with either route',async()=>{
  const args=input(raw()),before=structuredClone(args),review=await createOlderEditRecoveryReview(args);
  assert.equal(review.differences.length,1);
  assert.equal(review.differences[0].local.savedRoutes[0].route,'80');
  assert.equal(review.differences[0].shared.savedRoutes[0].route,'75');
  for(const use of ['local','shared']){
    const result=review.resolve([{id:journeyId(value('75')),use}]),out=JSON.parse(result.outputRaw);
    assert.equal(out.journeys[0].savedRoutes[0].route,use==='local'?'80':'75');
    assert.equal(out.journeys[0].count,11);assert.equal(out.journeys[0].last,42);assert.equal(out.learning,true);assert.equal(out.accessibility.stepFree,true);
    assert.equal(result.after.clock,use==='local'?2:1);assert.deepEqual(out.journeySync.pending,[]);
  }
  assert.deepEqual(args,before);assert.throws(()=>review.resolve([]));
  review.differences[0].local.savedRoutes[0].route='99';
  assert.equal(JSON.parse(review.resolve([{id:journeyId(value('75')),use:'local'}]).outputRaw).journeys[0].savedRoutes[0].route,'80');
});
test('queued deletion remains an explicit choice and inconsistent pending state refuses',async()=>{
  const operation={id:'1'.repeat(8)+'-'+ '2'.repeat(4)+'-'+ '3'.repeat(4)+'-'+ '4'.repeat(4)+'-'+ '5'.repeat(12),version,changes:[{id:journeyId(value('75')),value:null}]};
  const data=JSON.parse(raw('80',[operation]));data.journeys[0].saved=false;data.journeys[0].savedRoutes=null;
  const review=await createOlderEditRecoveryReview(input(JSON.stringify(data)));
  const result=review.resolve([{id:journeyId(value('75')),use:'local'}]);
  assert.equal(result.after.journeys[0].value,null);assert.equal(JSON.parse(result.outputRaw).journeys[0].count,11);
  await assert.rejects(createOlderEditRecoveryReview(input(raw('80',[operation]))));
});
test('recovery digest changes with newer local edits and refuses mismatched or completed application',async()=>{
  assert.notEqual((await createOlderEditRecoveryReview(input(raw('80')))).id,(await createOlderEditRecoveryReview(input(raw('81')))).id);
  await assert.rejects(createOlderEditRecoveryReview({...input(raw()),application:{...application,complete:true}}));
  await assert.rejects(createOlderEditRecoveryReview({...input(raw()),current:{...state,clock:2}}));
  const changed=JSON.parse(raw());changed.journeySync.version.generation=2;
  await assert.rejects(createOlderEditRecoveryReview(input(JSON.stringify(changed))));
});
