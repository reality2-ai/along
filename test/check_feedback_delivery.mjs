// Explicit integration check: creates and closes one labelled synthetic GitHub issue.
// Submission uses authenticated gh; receipt is checked by the actual browser UI,
// anonymously. This does not claim to test GitHub's interactive sign-in/composer.
import {execFileSync} from 'node:child_process';
import {writeFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {newFeedback,markHandoff,feedbackBody,repository} from '../public/feedback.js';
if(!process.argv.includes('--send-test-report'))throw Error('Pass --send-test-report to explicitly create and close one public synthetic issue.');
const base=process.env.TEST_BASE_URL;if(!base)throw Error('Set TEST_BASE_URL to the app under test.');
const directory=await mkdtemp(join(tmpdir(),'along-feedback-check-'));
const draft=markHandoff({...newFeedback({version:30,language:'en',screen:'settings'}),message:'Automated Along feedback integration test. This is a synthetic report, not commuter feedback. It contains no journey or personal data. The test submits the reviewed body through GitHub CLI, verifies receipt through the app in a browser without GitHub credentials, and closes this issue afterwards.'});
const file=join(directory,'report.md');await writeFile(file,feedbackBody(draft));
let issueUrl,context,evidence;
try{
  issueUrl=execFileSync('gh',['issue','create','--repo',repository,'--title','[Integration test] Along feedback receipt','--body-file',file],{encoding:'utf8'}).trim();
  context=await chromium.launchPersistentContext(join(directory,'browser'),{executablePath:process.env.CHROMIUM_PATH||undefined,headless:true});
  await context.addInitScript(d=>localStorage.setItem('along-feedback-v1',JSON.stringify(d)),draft);
  const page=await context.newPage();await page.goto(base);
  await page.locator('#settings-open').click();await page.locator('#settings [data-feedback-open]').click();
  await expect(page.locator('#feedback-status')).toContainText('not yet verified');
  await page.locator('#feedback-url').fill(issueUrl);await page.locator('#feedback-check').click();
  await expect(page.locator('#feedback-status')).toContainText('Receipt verified',{timeout:20000});
  await expect(page.locator('#feedback-confirmed')).toHaveAttribute('href',issueUrl);
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('along-feedback-v1')));
  expect(stored.receipt).toBe(issueUrl);expect(stored.id).toBe(draft.id);
  await page.locator('#feedback-close').click();await page.locator('#settings [data-feedback-open]').click();
  await expect(page.locator('#feedback-confirmed')).toBeFocused();await expect(page.locator('#feedback-github')).toBeHidden();
  evidence={checkedAt:new Date().toISOString(),app:base,issue:issueUrl,reportId:draft.id,submission:'Authenticated GitHub CLI with exact reviewed body',receipt:'Browser UI with anonymous GitHub API request',verified:true,existingIssueReopened:true,interactiveGitHubComposerTested:false};
}finally{
  if(context)await context.close();
  if(issueUrl)execFileSync('gh',['issue','close',issueUrl,'--repo',repository],{stdio:'pipe'});
  await rm(directory,{recursive:true,force:true});
}
const state=JSON.parse(execFileSync('gh',['issue','view',issueUrl,'--repo',repository,'--json','state'],{encoding:'utf8'}));
expect(state.state).toBe('CLOSED');evidence.testIssueClosed=true;
await mkdir('test-results',{recursive:true});await writeFile('test-results/feedback-delivery.json',JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
