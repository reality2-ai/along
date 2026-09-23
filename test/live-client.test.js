import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveClient} from '../public/live-client.js';
const response=data=>({ok:true,json:async()=>data});
const feed={available:true,updated:1000,entities:[]};
test('unrequested, unconfigured and offline clients never make requests',async()=>{
  let calls=0;const fetcher=()=>{calls++;throw Error('unexpected');};
  const client=createLiveClient({baseURL:'https://proxy.example/api/',fetcher});
  assert.equal((await client.read('predictions')).reason,'not-requested');
  assert.equal((await createLiveClient({fetcher}).read('alerts',{requested:true})).reason,'not-configured');
  assert.equal((await createLiveClient({baseURL:'https://proxy.example/api/',fetcher,online:()=>false}).read('alerts',{requested:true})).reason,'offline');
  assert.equal(calls,0);
});
test('explicit read sends no context, credentials or referrer; caches only fresh data',async()=>{
  let at=1170,calls=[];
  const client=createLiveClient({baseURL:'https://proxy.example/along-api/',now:()=>at,fetcher:async(url,options)=>{calls.push({url:String(url),options});return response(feed);}});
  assert.equal((await client.read('predictions',{requested:true})).available,true);
  await client.read('predictions',{requested:true});assert.equal(calls.length,1);
  at=1181;assert.equal((await client.read('predictions',{requested:true})).reason,'stale');assert.equal(calls.length,2);
  assert.equal(calls[0].url,'https://proxy.example/along-api/predictions');
  assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.referrerPolicy,'no-referrer');
  assert.equal(calls[0].options.body,undefined);assert.equal(calls[0].options.redirect,'error');
});
test('simultaneous reads share one request; cancellation discards late results',async()=>{
  let resolve,calls=0;
  const client=createLiveClient({baseURL:'https://proxy.example/api/',now:()=>1000,fetcher:()=>{calls++;return new Promise(r=>resolve=r);}});
  const first=client.read('predictions',{requested:true}),second=client.read('predictions',{requested:true});
  assert.equal(calls,1);client.cancel();resolve(response(feed));
  assert.equal((await first).available,false);assert.equal((await second).available,false);
});
test('bad feeds, failed requests and timeout all fall back quietly',async()=>{
  for(const data of [{...feed,updated:true},{...feed,updated:NaN},{...feed,entities:null},{available:false}]){
    const c=createLiveClient({baseURL:'https://proxy.example/api/',now:()=>1000,fetcher:async()=>response(data)});
    assert.equal((await c.read('predictions',{requested:true})).available,false);
  }
  const c=createLiveClient({baseURL:'https://proxy.example/api/',fetcher:async()=>{throw Error('network');}});
  assert.equal((await c.read('predictions',{requested:true})).reason,'unavailable');
  const slow=createLiveClient({baseURL:'https://proxy.example/api/',timeoutMs:5,fetcher:(_,options)=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted'))))});
  assert.equal((await slow.read('predictions',{requested:true})).available,false);
});
test('configuration rejects credentials, query strings and insecure remote hosts',()=>{
  for(const baseURL of ['http://proxy.example/api/','https://user:key@proxy.example/api/','https://proxy.example/api/?key=secret','https://proxy.example/api/#x','https://proxy.example/api'])
    assert.throws(()=>createLiveClient({baseURL}));
  assert.equal(createLiveClient({baseURL:'./api/',pageURL:'http://127.0.0.1:3080/'}).configured,true);
});
