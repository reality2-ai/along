import test from 'node:test';
import assert from 'node:assert/strict';
import {departurePrediction} from '../public/live-predictions.js';
import {createATClient,normaliseATFeed} from '../public/at-client.js';
const payload={response:{header:{timestamp:1000.813},entity:[]}};
test('direct client reads only on explicit online request, sends key only to fixed AT endpoints',async()=>{
 let reads=0;const calls=[];
 const client=createATClient({now:()=>1001,getKey:async()=>{reads++;return 'personal-test-key';},fetcher:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>payload};}});
 await client.read('vehicles');assert.equal(reads,0);
 for(const [kind,endpoint] of [['predictions','tripupdates'],['alerts','servicealerts'],['vehicles','vehiclelocations']]){
  const result=await client.read(kind,{requested:true});assert.equal(result.available,true);assert.equal(result.updated,1000);
  const {url,options}=calls.at(-1);assert.equal(url,'https://api.at.govt.nz/realtime/legacy/'+endpoint);
  assert.equal(options.headers['Ocp-Apim-Subscription-Key'],'personal-test-key');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.body,undefined);
  assert.equal(JSON.stringify(result).includes('personal-test-key'),false);
 }
 await client.read('vehicles',{requested:true});assert.equal(reads,3);
 const offline=createATClient({getKey:()=>{throw Error('must not read');},online:()=>false});assert.equal((await offline.read('vehicles',{requested:true})).reason,'offline');
 assert.equal(createATClient().configured,false);
});
test('cancel during key retrieval prevents any network request',async()=>{
 let resolve,calls=0;
 const client=createATClient({getKey:()=>new Promise(r=>resolve=r),fetcher:()=>{calls++;}});
 const pending=client.read('vehicles',{requested:true});client.cancel();resolve('key');
 assert.equal((await pending).available,false);assert.equal(calls,0);
});
test('credential errors remain generic and a revoked client cannot reuse cached feeds',async()=>{
 let key='key',calls=0;
 const client=createATClient({now:()=>1001,getKey:()=>key,fetcher:async()=>{calls++;return {ok:true,json:async()=>payload};}});
 await client.read('vehicles',{requested:true});client.cancel();key=null;
 const result=await client.read('vehicles',{requested:true});assert.equal(result.available,false);assert.equal(calls,1);
 for(const key of ['',true,'key\nother']){
  const c=createATClient({getKey:()=>key,fetcher:()=>{throw Error('must not fetch');}});
  assert.equal((await c.read('alerts',{requested:true})).available,false);
 }
});
test('AT conversion accepts fractional header seconds but rejects malformed timestamps',()=>{
 for(const value of [1000.813,'1000.813',1000])assert.equal(normaliseATFeed('vehicles',{header:{timestamp:value},entity:[]}).updated,1000);
 for(const value of [true,null,undefined,NaN,Infinity,-1,'','1e3','1000x'])assert.equal(normaliseATFeed('vehicles',{header:{timestamp:value},entity:[]}).available,false);
});
test('alert conversion preserves restrictions and all records with English text',()=>{
 const a={header_text:{translation:[{language:'mi',text:'draft'},{language:'en-NZ',text:'Platform change'}]},description_text:{translation:[{text:'Use signs'}]},informed_entity:[{route_id:'r',unknown_scope:1}],active_period:[{start:1}],communication_period:[{start:2}],impact_period:[{start:3}]};
 const source={header:{timestamp:1000.5},entity:[...Array.from({length:40},(_,i)=>({id:String(i),alert:a})),{is_deleted:true,alert:a}]};
 const result=normaliseATFeed('alerts',source);assert.equal(result.alerts.length,40);assert.equal(result.alerts[0].title,'Platform change');
 for(const field of ['informed_entity','active_period','communication_period','impact_period'])assert.deepEqual(result.alerts[0][field],a[field]);
});

test('an unresponsive credential provider times out without fetching',async()=>{
 let calls=0;
 const client=createATClient({getKey:()=>new Promise(()=>{}),timeoutMs:5,fetcher:()=>{calls++;}});
 assert.equal((await client.read('alerts',{requested:true})).available,false);assert.equal(calls,0);
});
test('explicit null alert scopes stay malformed instead of becoming unrestricted',()=>{
 const result=normaliseATFeed('alerts',{header:{timestamp:1000},entity:[{alert:{informed_entity:null,active_period:null}}]});
 assert.equal(result.alerts[0].informed_entity,null);assert.equal(result.alerts[0].active_period,null);
});

test('AT single-stop JSON records reach the strict matcher without changing trip or stop scope',()=>{
 const event={stop_id:'s',stop_sequence:12,departure:{delay:90},schedule_relationship:0};
 const trip={trip_id:'t',route_id:'r',start_date:'20260923',start_time:'09:00:00'};
 const source={header:{timestamp:1000.5},entity:[{trip_update:{trip,stop_time_update:event}}]};
 const result=normaliseATFeed('predictions',source);
 const departure={trip:'t',routeId:'r',serviceDate:'20260923',startTime:'09:00:00',stop:{id:'s'},stopVisits:1};
 assert.equal(departurePrediction(result,departure,{now:1001}).delay,90);
 assert.equal(departurePrediction(result,{...departure,serviceDate:'20260924'},{now:1001}).status,'scheduled');
 assert.equal(departurePrediction(result,{...departure,stopVisits:2},{now:1001}).status,'scheduled');
 assert.equal(source.entity[0].trip_update.stop_time_update,event);
 assert.deepEqual(result.entities[0].trip_update.stop_time_update,[event]);
 for(const malformed of [null,{},'invalid',false]){
  const feed=normaliseATFeed('predictions',{header:{timestamp:1000},entity:[{trip_update:{trip,stop_time_update:malformed}}]});
  assert.equal(departurePrediction(feed,departure,{now:1001}).status,'scheduled');
 }
});
