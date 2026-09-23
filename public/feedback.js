// Local drafts and explicit GitHub handoff. No credentials or automatic sending.
export const feedbackKey='along-feedback-v1';
export const repository='reality2-ai/along';
const screens=new Set(['destination','origin','review','options','follow','arrived','nearby','details','settings']);
const validId=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
export function newFeedback(context={},id=crypto.randomUUID()){
  if(!validId(id))throw new Error('Invalid feedback ID');
  return {id,message:'',shareContext:false,context:{
    version:/^\d+$/.test(String(context.version))?String(context.version):'unknown',
    language:['en','mi'].includes(context.language)?context.language:'en',
    screen:screens.has(context.screen)?context.screen:'settings'
  },handoff:null,receipt:null};
}
export function readFeedback(storage){
  try{
    storage??=globalThis.localStorage;
    const raw=JSON.parse(storage.getItem(feedbackKey));
    if(!raw||!validId(raw.id)||typeof raw.message!=='string'||raw.message.length>4000)return null;
    const draft=newFeedback(raw.context,raw.id);
    draft.message=raw.message;draft.shareContext=raw.shareContext===true;
    // A saved handoff is immutable: receipt checks use what was actually reviewed.
    if(raw.handoff&&typeof raw.handoff.body==='string'&&raw.handoff.body.length<=6000&&raw.handoff.body===feedbackBody(draft))draft.handoff={body:raw.handoff.body};
    if(draft.handoff&&issueNumber(raw.receipt))draft.receipt=raw.receipt;
    return draft;
  }catch{return null;}
}
export function writeFeedback(draft,storage){
  try{storage??=globalThis.localStorage;storage.setItem(feedbackKey,JSON.stringify(draft));return true;}catch{return false;}
}
export function clearFeedback(storage){
  try{storage??=globalThis.localStorage;storage.removeItem(feedbackKey);return true;}catch{return false;}
}
export function feedbackBody(draft){
  const clean=newFeedback(draft.context,draft.id);
  if(typeof draft.message!=='string'||!draft.message.trim()||draft.message.length>4000)throw new Error('Feedback must contain 1–4000 characters');
  const context=draft.shareContext?`\n\nShared context: Along ${clean.context.version}; language ${clean.context.language}; screen ${clean.context.screen}.`:'';
  return `${draft.message.trim()}${context}\n\nAlong feedback ID: ${draft.id}`;
}
export function prepareHandoff(draft){
  if(draft.receipt)return {url:draft.receipt,body:draft.handoff?.body||'',copyRequired:false,existing:true};
  const body=draft.handoff?.body||feedbackBody(draft);
  const url=new URL(`https://github.com/${repository}/issues/new`);
  url.searchParams.set('title','Along feedback');url.searchParams.set('body',body);
  // Long Unicode text can exceed server URL limits; preserve it for explicit copy.
  const copyRequired=url.href.length>7000;
  if(copyRequired)url.searchParams.delete('body');
  return {url:url.href,body,copyRequired,existing:false};
}
export function markHandoff(draft){
  if(draft.receipt)return draft;
  return {...draft,handoff:{body:draft.handoff?.body||feedbackBody(draft)}};
}
export function issueNumber(value){
  if(typeof value!=='string')return null;
  try{
    const url=new URL(value);
    if(url.origin!=='https://github.com'||url.username||url.password||url.search||url.hash)return null;
    const match=url.pathname.match(/^\/reality2-ai\/along\/issues\/([1-9]\d*)\/?$/);
    return match?.[1]||null;
  }catch{return null;}
}
export async function verifyFeedbackReceipt(draft,url,{fetcher=globalThis.fetch,signal}={}){
  const number=issueNumber(url);
  if(!number||!draft.handoff)return {status:'invalid'};
  try{
    const response=await fetcher(`https://api.github.com/repos/${repository}/issues/${number}`,{signal,credentials:'omit',referrerPolicy:'no-referrer',headers:{Accept:'application/vnd.github+json'}});
    if(!response.ok)return {status:'unavailable'};
    const issue=await response.json();
    // An unrelated issue or PR must never count as receipt of this report.
    if(issue.pull_request||issueNumber(issue.html_url)!==number||typeof issue.body!=='string'||!issue.body.includes(draft.handoff.body))return {status:'mismatch'};
    return {status:'received',url:`https://github.com/${repository}/issues/${number}`,number};
  }catch{return {status:'unavailable'};}
}
