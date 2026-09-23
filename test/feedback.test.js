import test from 'node:test';
import assert from 'node:assert/strict';
import {newFeedback,readFeedback,writeFeedback,clearFeedback,feedbackBody,prepareHandoff,markHandoff,verifyFeedbackReceipt,issueNumber} from '../public/feedback.js';
const id='12345678-1234-1234-1234-123456789abc';
const draft=()=>({...newFeedback({version:30,language:'mi',screen:'options'},id),message:'The stop information was unclear.'});
const storage=()=>{let value=null;return {getItem:()=>value,setItem:(key,v)=>{value=v;},removeItem:()=>{value=null;}};};
test('feedback draft persists offline, excludes undeclared context and tolerates blocked storage',()=>{
  const s=storage(),d=draft();d.context.address='private address';d.context.history=['private history'];
  assert.equal(writeFeedback(d,s),true);
  const restored=readFeedback(s);assert.equal(restored.message,d.message);assert.equal(restored.id,id);
  assert.equal(feedbackBody(restored).includes('Shared context'),false);
  restored.shareContext=true;assert.match(feedbackBody(restored),/Along 30; language mi; screen options/);
  assert.doesNotMatch(feedbackBody(restored),/private/);
  const blocked={getItem(){throw Error();},setItem(){throw Error();},removeItem(){throw Error();}};
  assert.equal(readFeedback(blocked),null);assert.equal(writeFeedback(d,blocked),false);assert.equal(clearFeedback(blocked),false);
  assert.equal(clearFeedback(s),true);assert.equal(readFeedback(s),null);
});
test('handoff is a reviewable GitHub composer, never a delivery receipt; long text is retained for copy',()=>{
  const d=draft(),first=prepareHandoff(d),url=new URL(first.url);
  assert.equal(url.origin,'https://github.com');assert.equal(url.pathname,'/reality2-ai/along/issues/new');
  assert.equal(url.searchParams.get('body'),feedbackBody(d));assert.equal(d.receipt,null);
  const handed=markHandoff(d);handed.message='Later changes cannot silently replace reviewed text';
  assert.equal(prepareHandoff(handed).body,first.body);
  const long={...draft(),message:'ā'.repeat(4000)};const next=prepareHandoff(long);
  assert.equal(next.copyRequired,true);assert.equal(new URL(next.url).searchParams.has('body'),false);assert.equal(next.body,feedbackBody(long));
  assert.throws(()=>feedbackBody({...d,message:' '}));
});
test('receipt verification only fetches an exact repository issue and checks the submitted report',async()=>{
  const d=markHandoff(draft()),url='https://github.com/reality2-ai/along/issues/12';let calls=0;
  const fetcher=async(target,options)=>{calls++;assert.equal(target,'https://api.github.com/repos/reality2-ai/along/issues/12');assert.equal(options.credentials,'omit');return {ok:true,json:async()=>({html_url:url,body:d.handoff.body})};};
  for(const bad of ['https://evil.test/issues/12','https://github.com/reality2-ai/other/issues/12',url+'?token=x','https://name:password@github.com/reality2-ai/along/issues/12'])assert.equal((await verifyFeedbackReceipt(d,bad,{fetcher})).status,'invalid');
  assert.equal(calls,0);assert.equal(issueNumber(url),'12');
  const result=await verifyFeedbackReceipt(d,url,{fetcher});assert.equal(result.status,'received');
  assert.equal((await verifyFeedbackReceipt(d,url,{fetcher:async()=>({ok:true,json:async()=>({html_url:url,body:'unrelated'})})})).status,'mismatch');
  assert.equal((await verifyFeedbackReceipt(d,url,{fetcher:async()=>({ok:true,json:async()=>({html_url:url,body:d.handoff.body,pull_request:{}})})})).status,'mismatch');
  assert.equal((await verifyFeedbackReceipt(d,url,{fetcher:async()=>{throw Error('offline');}})).status,'unavailable');
  const received={...d,receipt:result.url};assert.equal(prepareHandoff(received).url,url);assert.equal(prepareHandoff(received).existing,true);
});
