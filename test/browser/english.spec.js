import {test,expect} from '@playwright/test';
test('previous Māori preference cannot enable translations in app, guide or recovery',async({page,context})=>{
  const saved=JSON.stringify({learning:false,journeys:[]});
  await page.addInitScript(value=>{localStorage.setItem('along-language-v1','mi');localStorage.setItem('along-journeys-v1',value);},saved);
  await page.goto('/');await expect(page.locator('#data-status')).toContainText('offline ready',{timeout:90000});
  await expect(page.locator('#flow-title')).toHaveText('Where would you like to go?');
  await page.locator('#settings-open').click();await expect(page.locator('#language-choice')).toHaveCount(0);
  expect(await page.evaluate(()=>localStorage.getItem('along-journeys-v1'))).toBe(saved);
  await context.setOffline(true);await page.reload();await expect(page.locator('#flow-title')).toHaveText('Where would you like to go?');
  await page.goto('/install.html');await expect(page.locator('h1')).toHaveText('Install Along and use it offline');
  await expect(page.locator('#guide-language-choice')).toHaveCount(0);await expect(page.locator('[lang="mi-NZ"]')).toHaveCount(0);
  await context.setOffline(false);await page.goto('/update.html');await expect(page.locator('h1')).toHaveText('Update Along');
  await expect(page.locator('#recovery-draft')).toHaveCount(0);await expect(page.locator('html')).toHaveAttribute('lang','en-NZ');
});
