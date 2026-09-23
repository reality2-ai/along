import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('feedback preserves an offline draft, reviews only chosen context and verifies explicit receipt',async({page,context})=>{
  await page.setViewportSize({width:360,height:780});
  await page.goto('/');await expect(page.locator('#data-status')).toContainText('offline ready',{timeout:90000});
  await page.locator('#destination').fill('private destination example');
  await page.locator('#settings-open').click();await page.locator('#language-choice').selectOption('mi');
  const entry=page.locator('#settings [data-feedback-open]');await entry.click();
  await expect(page.locator('#feedback-title')).toHaveText('Urupare mō Along');
  await expect(page.locator('#feedback-context')).not.toBeChecked();
  await page.locator('#feedback-message').fill('The departure board label is confusing.');
  await page.locator('#feedback-close').click();await expect(entry).toBeFocused();
  await page.locator('#settings .close-dialog').click();
  await expect(page.locator('#destination')).toHaveValue('private destination example');
  await context.setOffline(true);await page.reload();
  await page.locator('#settings-open').click();await page.locator('#language-choice').selectOption('en');await entry.click();
  await expect(page.locator('#feedback-message')).toHaveValue('The departure board label is confusing.');
  await page.locator('#feedback-review').click();
  const text=await page.locator('#feedback-body').inputValue();
  expect(text).not.toContain('Shared context');expect(text).not.toContain('private destination');
  // Chromium's emulated offline flag can reset navigator.onLine after reload.
  await context.setOffline(false);await context.setOffline(true);
  await expect.poll(()=>page.evaluate(()=>navigator.onLine)).toBe(false);
  await page.locator('#feedback-github').click();await expect(page.locator('#feedback-status')).toContainText('offline');
  await page.locator('#feedback-edit-again').click();await page.locator('#feedback-context').check();await page.locator('#feedback-review').click();
  const body=await page.locator('#feedback-body').inputValue();expect(body).toContain('language mi; screen settings');
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await context.setOffline(false);
  // The public handoff is intercepted: this test never submits feedback to GitHub.
  await context.route('https://github.com/**',route=>route.fulfill({body:'GitHub composer test fixture',contentType:'text/html'}));
  const popupPromise=page.waitForEvent('popup');await page.locator('#feedback-github').click();const popup=await popupPromise;await popup.waitForURL('https://github.com/**');
  expect(new URL(popup.url()).searchParams.get('body')).toBe(body);await popup.close();
  await expect(page.locator('#feedback-status')).toContainText('not yet verified');
  await expect(page.locator('#feedback-github')).toBeHidden();await expect(page.locator('#feedback-reopen')).toBeHidden();
  const issueUrl='https://github.com/reality2-ai/along/issues/123';
  await context.route('https://api.github.com/repos/reality2-ai/along/issues/123',route=>route.fulfill({json:{html_url:issueUrl,body}}));
  await page.locator('#feedback-url').fill(issueUrl);await page.locator('#feedback-check').click();
  await expect(page.locator('#feedback-status')).toContainText('Receipt verified');
  await expect(page.locator('#feedback-confirmed')).toHaveAttribute('href',issueUrl);
  await expect(page.locator('#feedback-receipt')).toBeHidden();
  await page.keyboard.press('Escape');await expect(entry).toBeFocused();
  await entry.click();await expect(page.locator('#feedback-confirmed')).toBeVisible();
  await page.locator('#feedback-clear').click();await entry.click();await expect(page.locator('#feedback-message')).toBeEmpty();
});

test('route feedback returns to its detail and shares only a general screen category',async({page})=>{
  await page.goto('/');await expect(page.locator('#data-status')).toContainText('offline ready',{timeout:90000});
  await page.locator('#browse-routes').click();await page.locator('#route-search').fill('70');
  await page.locator('#route-search-results button').first().click();
  const title=await page.locator('#detail-title').textContent();
  const entry=page.locator('#information [data-feedback-open]');await entry.click();
  await page.locator('#feedback-message').fill('I could not find an entrance.');
  await page.locator('#feedback-context').check();await page.locator('#feedback-review').click();
  const body=await page.locator('#feedback-body').inputValue();
  expect(body).toContain('screen details');expect(body).not.toContain(title);
  await page.keyboard.press('Escape');await expect(entry).toBeFocused();
  await expect(page.locator('#information')).toBeVisible();await expect(page.locator('#detail-title')).toHaveText(title);
  await page.locator('#detail-back').click();await expect(page.locator('#route-search')).toHaveValue('70');
});

test('blocked feedback storage keeps the in-memory draft and explains the limitation',async({page})=>{
  await page.addInitScript(()=>{
    for(const method of ['setItem','removeItem']){
      const original=Storage.prototype[method];Storage.prototype[method]=function(key,...args){if(key==='along-feedback-v1')throw Error('blocked');return original.call(this,key,...args);};
    }
  });
  await page.goto('/');await page.locator('#settings-open').click();await page.locator('#settings [data-feedback-open]').click();
  await page.locator('#feedback-message').fill('Keep this draft in this session.');
  await expect(page.locator('#feedback-storage')).toContainText('Storage is unavailable');
  await page.locator('#feedback-clear').click();await expect(page.locator('#feedback')).toBeVisible();
  await expect(page.locator('#feedback-message')).toHaveValue('Keep this draft in this session.');
  await page.locator('#feedback-close').click();await page.locator('#settings [data-feedback-open]').click();
  await expect(page.locator('#feedback-message')).toHaveValue('Keep this draft in this session.');
});

test('late receipt cannot mark a new draft received and retry controls reset',async({page})=>{
  const {newFeedback,markHandoff}=await import('../../public/feedback.js');
  const draft=markHandoff({...newFeedback({version:30,screen:'settings'}),message:'Old test report'});
  await page.addInitScript(d=>localStorage.setItem('along-feedback-v1',JSON.stringify(d)),draft);
  let pendingRoute;const requested=new Promise(resolve=>{pendingRoute=resolve;});
  await page.route('https://api.github.com/repos/reality2-ai/along/issues/456',route=>{pendingRoute(route);});
  await page.goto('/');await page.locator('#settings-open').click();await page.locator('#settings [data-feedback-open]').click();
  await page.locator('#feedback-retry summary').click();await page.locator('#feedback-not-submitted').check();
  await expect(page.locator('#feedback-reopen')).toBeVisible();
  const url='https://github.com/reality2-ai/along/issues/456';await page.locator('#feedback-url').fill(url);await page.locator('#feedback-check').click();
  const route=await requested;
  await page.locator('#feedback-clear').click();await page.locator('#settings [data-feedback-open]').click();
  await page.locator('#feedback-message').fill('New unrelated draft');
  const response=page.waitForResponse('https://api.github.com/repos/reality2-ai/along/issues/456');
  await route.fulfill({json:{html_url:url,body:draft.handoff.body}});await response;
  await expect(page.locator('#feedback-message')).toHaveValue('New unrelated draft');
  await expect(page.locator('#feedback-confirmed')).toBeHidden();
  await expect(page.locator('#feedback-status')).toBeEmpty();
  await expect(page.locator('#feedback-not-submitted')).not.toBeChecked();
  await expect(page.locator('#feedback-url')).toHaveValue('');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('along-feedback-v1')).receipt)).toBeNull();
});
