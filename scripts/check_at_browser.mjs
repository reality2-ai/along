// Explicit authenticated verification only. Never run as part of ordinary tests.
// No traces, screenshots, request logs, credentials or raw feeds are saved.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium} from '@playwright/test';
let browser;
try{
 const key=(process.env.AT_API_KEY??await readFile(new URL('../APIKey',import.meta.url),'utf8')).trim();
 if(!key||key.length>4096||/\s/.test(key))throw new Error('Invalid credential');
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 const context=await browser.newContext({serviceWorkers:'block'});
 const page=await context.newPage();
 // Simulate the actual page origin locally; no changes to the public website.
 await page.route('https://reality2.ai/along/__direct-at-check',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Local AT browser verification</title>'}));
 await page.goto('https://reality2.ai/along/__direct-at-check');
 const feeds=await page.evaluate(async credential=>{
  const results={};
  for(const endpoint of ['tripupdates','servicealerts','vehiclelocations']){
   try{
    const response=await fetch('https://api.at.govt.nz/realtime/legacy/'+endpoint,{
     headers:{'Ocp-Apim-Subscription-Key':credential,'Accept':'application/json'},
     credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
    const body=await response.json(),feed=body.response??body,updated=Number(feed.header?.timestamp);
    results[endpoint]={status:response.status,readable:true,entities:Array.isArray(feed.entity)?feed.entity.length:0,
     updated:Number.isFinite(updated)?updated:null,requires_timestamp_normalization:Number.isFinite(updated)&&!Number.isInteger(updated),fresh:response.ok&&Array.isArray(feed.entity)&&Number.isFinite(updated)&&updated>0&&Math.abs(Date.now()/1000-updated)<=180};
   }catch{results[endpoint]={readable:false,fresh:false};}
  }
  return results;
 },key);
 const report={checked_at:new Date().toISOString(),browser:browser.version(),page_origin:'https://reality2.ai',
  harness:'Locally fulfilled test page at the app origin; real cross-origin AT requests through Chromium.',
  credential_recorded:false,public_live_enabled:false,feeds};
 await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
 await writeFile(new URL('../test-results/at-direct-browser.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
 if(!Object.values(feeds).every(f=>f.fresh))process.exitCode=1;
}catch{console.error('Direct AT browser verification could not complete. No credential details recorded.');process.exitCode=1;}
finally{await browser?.close();}
