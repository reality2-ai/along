// Explicit integration check: creates and closes one labelled synthetic issue.
// The actual app creates/reviews the draft and opens the real GitHub handoff.
// Authenticated gh submits it; the browser verifies receipt anonymously. This
// does not claim to exercise GitHub's signed-in composer/Submit new issue button.
import {execFileSync} from 'node:child_process';
import {writeFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {repository} from '../public/feedback.js';
if(!process.argv.includes('--send-test-report'))throw Error('Pass --send-test-report to explicitly create and close one public synthetic issue.');
const base=process.env.TEST_BASE_URL;if(!base)throw Error('Set TEST_BASE_URL to the app under test.');
const directory=await mkdtemp(join(tmpdir(),'along-feedback-check-'));
const message='Automated Along feedback integration test. This is a synthetic report, not commuter feedback. It contains no journey or personal data. The test types and reviews this report in the published app, submits that exact body through GitHub CLI, verifies receipt anonymously in the app, and closes this issue afterwards.';
let issueUrl,context,evidence={checkedAt:new Date().toISOString(),app:base,verified:false,interactiveGitHubComposerTested:false},failure;
try{
  context=await chromium.launchPersistentContext(join(directory,'browser'),{executablePath:process.env.CHROMIUM_PATH||undefined,headless:true});
  const page=await context.newPage();await page.goto(base);
  await expect(page.locator('#address-status')).toContainText('ready offline',{timeout:90000});
  const version=(await page.locator('#settings').textContent()).match(/App version (\d+)/)?.[1];
  const storageKey=await page.evaluate(async()=> (await import(new URL('./feedback.js',location.href))).feedbackKey);
  const stored=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),storageKey);
  const open=async()=>{await page.locator('#settings-open').click();await page.locator('#settings [data-feedback-open]').click();};
  await page.locator('#destination').fill('not-for-feedback-placeholder');
  await open();await expect(page.locator('#feedback-context')).not.toBeChecked();
  await page.locator('#feedback-message').fill(message);
  await page.locator('#feedback-close').click();await page.locator('#settings .close-dialog').click();
  await expect(page.locator('#destination')).toHaveValue('not-for-feedback-placeholder');
  await context.setOffline(true);await page.reload();await open();
  await expect(page.locator('#feedback-message')).toHaveValue(message);
  await page.locator('#feedback-review').click();
  const body=await page.locator('#feedback-body').inputValue();
  expect(body).not.toContain('Shared context');expect(body).not.toContain('not-for-feedback-placeholder');
  const draft=await stored();expect(draft.context.version).toBe(version);
  await context.setOffline(false);
  const handoff=new URL(await page.locator('#feedback-github').getAttribute('href'));
  expect(handoff.origin).toBe('https://github.com');expect(handoff.pathname).toBe('/'+repository+'/issues/new');
  expect(handoff.searchParams.get('body')).toBe(body);
  const popupPromise=page.waitForEvent('popup');await page.locator('#feedback-github').click();
  const popup=await popupPromise;await popup.waitForLoadState('domcontentloaded');
  const destination=new URL(popup.url());
  expect(destination.origin).toBe('https://github.com');
  const handoffDestination=destination.pathname;await popup.close();
  await expect(page.locator('#feedback-status')).toContainText('not yet verified');
  expect((await stored()).handoff.body).toBe(body);
  const file=join(directory,'report.md');await writeFile(file,body);
  issueUrl=execFileSync('gh',['issue','create','--repo',repository,'--title','[Integration test] Along '+version+' feedback receipt','--body-file',file],{encoding:'utf8'}).trim();
  console.log('Created labelled synthetic test report: '+issueUrl);
  const anonymous=[];
  page.on('request',request=>{if(request.url().startsWith('https://api.github.com/repos/'+repository+'/issues/'))anonymous.push(!request.headers().authorization&&!request.headers().cookie);});
  await page.locator('#feedback-url').fill(issueUrl);
  await context.setOffline(true);await page.locator('#feedback-check').click();
  await expect(page.locator('#feedback-status')).toContainText('Receipt could not be checked');
  expect((await stored()).receipt).toBeNull();expect((await stored()).handoff.body).toBe(body);
  await context.setOffline(false);await page.locator('#feedback-check').click();
  await expect(page.locator('#feedback-status')).toContainText('Receipt verified',{timeout:20000});
  await expect(page.locator('#feedback-confirmed')).toHaveAttribute('href',issueUrl);
  expect((await stored()).receipt).toBe(issueUrl);expect((await stored()).id).toBe(draft.id);
  expect(anonymous.length).toBeGreaterThan(0);expect(anonymous.every(Boolean)).toBe(true);
  await context.setOffline(true);await page.reload();await open();
  await expect(page.locator('#feedback-confirmed')).toBeFocused();await expect(page.locator('#feedback-confirmed')).toHaveAttribute('href',issueUrl);
  await expect(page.locator('#feedback-github')).toBeHidden();expect((await stored()).id).toBe(draft.id);
  evidence={...evidence,appVersion:version,storageKey,issue:issueUrl,reportId:draft.id,
    draft:'Typed and reviewed through the actual app UI; recovered after offline reload',
    submission:'Authenticated GitHub CLI with exact UI-reviewed body',handoff:'Actual anonymous GitHub navigation',handoffDestination,
    receipt:'Browser UI with anonymous GitHub API request',verified:true,offlineReceiptRetry:true,
    existingIssueReopenedOffline:true,noAutomaticFormContext:true,anonymousReceiptRequests:true};
}catch(error){failure=error;evidence={...evidence,issue:issueUrl,error:error.message};}
finally{
  if(context)await context.close();
  if(issueUrl){
    execFileSync('gh',['issue','close',issueUrl,'--repo',repository],{stdio:'pipe'});
    const state=JSON.parse(execFileSync('gh',['issue','view',issueUrl,'--repo',repository,'--json','state'],{encoding:'utf8'}));
    expect(state.state).toBe('CLOSED');evidence.testIssueClosed=true;
  }
  await rm(directory,{recursive:true,force:true});
}
await mkdir('test-results',{recursive:true});await writeFile('test-results/feedback-delivery.json',JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
if(failure)throw failure;
