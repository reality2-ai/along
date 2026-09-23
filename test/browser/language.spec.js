import {test, expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function choose(page, field, query) {
  await page.locator('#'+field).fill(query);
  await page.locator('#'+field+'-options [data-index]').first().click();
}
async function switchTo(page, language) {
  await page.locator('#settings-open').click();
  await page.locator('#language-choice').focus();
  await page.locator('#language-choice').selectOption(language);
  await expect(page.locator('#language-choice')).toBeFocused();
  await page.locator('#settings .close-dialog').click();
}

test('draft language switch preserves current task, saved places, Back and offline planning', async ({page, context}) => {
  await page.setViewportSize({width:360,height:780});
  const errors=[];page.on('pageerror', error=>errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#data-status')).toContainText('offline ready',{timeout:90000});
  await page.locator('#course-understood').click();
  await page.locator('#destination-next').click();
  await expect(page.locator('#form-error')).toHaveText('Choose a destination from the suggestions.');
  await choose(page,'destination','10 Victoria Road Devonport');
  await page.locator('#destination-next').click();
  const destination=await page.locator('#destination').inputValue();
  await switchTo(page,'mi');
  await expect(page.locator('html')).toHaveAttribute('lang','mi-NZ');
  await expect(page.locator('#flow-title')).toHaveText('Kei te haere mai koe i hea?');
  await expect(page.locator('#form-error')).toBeEmpty();
  await expect(page.locator('#flow-title')).toHaveAttribute('lang','mi-NZ');
  await expect(page.locator('#flow-context')).toContainText(destination);
  await expect(page.locator('#flow-context')).toHaveAttribute('lang','mi-NZ');
  await expect(page.locator('#origin-help')).toHaveAttribute('lang','mi-NZ');
  await expect(page.locator('label[for=origin]')).toContainText('Wāhi tīmatanga');
  await expect(page.locator('#language-notice')).toBeVisible();
  await choose(page,'origin','277 Broadway Newmarket');
  await page.locator('#origin-next').click();
  await expect(page.locator('#flow-title')).toHaveText('Arotakengia tō haerenga');
  await page.locator('#journey-preferences > summary').click();
  await expect(page.locator('.modes')).toContainText('Waka kōpiko');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:'test-results/maori-review-draft.png',fullPage:true});
  await page.locator('#journey-preferences > summary').click();
  await page.locator('#save-places').click();
  const saved=await page.evaluate(()=>localStorage.getItem('along-journeys-v1'));
  await switchTo(page,'en');
  await expect(page.locator('#flow-title')).toHaveText('Review your journey');
  await expect(page.locator('#save-places')).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(()=>localStorage.getItem('along-journeys-v1'))).toBe(saved);
  await page.locator('#flow-back').click();
  await expect(page.locator('#origin')).toBeVisible();
  await expect(page.locator('#origin')).toHaveValue(/277 Broadway/);
  await switchTo(page,'mi');
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await context.setOffline(true);await page.reload();
  await expect(page.locator('#data-status')).toContainText('ready',{timeout:60000});
  await expect(page.locator('#flow-title')).toHaveText('Kei te hiahia haere koe ki hea?');
  expect(await page.evaluate(()=>localStorage.getItem('along-journeys-v1'))).toBe(saved);
  await choose(page,'destination','1 Queen Street Auckland Central');
  await page.locator('#destination-next').click();
  await choose(page,'origin','277 Broadway Newmarket');
  await page.locator('#origin-next').click();
  await page.locator('#journey-preferences > summary').click();
  await page.locator('#date').fill('2026-09-23');await page.locator('#time').fill('09:00');
  await page.locator('#find').click();
  await expect(page.locator('.journey-card').first()).toBeVisible({timeout:30000});
  await expect(page.locator('#flow-title')).toHaveText('Kōwhiria tō haerenga');
  await switchTo(page,'en');
  await expect(page.locator('.journey-card').first()).toBeVisible();
  await expect(page.locator('#flow-title')).toHaveText('Choose your journey');
  await page.locator('[data-follow]').first().click();
  await page.locator('#prefer-services').click();
  const savedServices=await page.evaluate(()=>localStorage.getItem('along-journeys-v1'));
  await page.locator('#full-itinerary > summary').click();
  const step=await page.locator('#step-count').textContent();
  await switchTo(page,'mi');
  await expect(page.locator('#step-count')).toContainText('Hipanga');
  await expect(page.locator('#itinerary-legs')).toContainText('Ngā tohutohu hīkoi');
  await expect(page.locator('#prefer-services')).toContainText('Ngā ratonga e manakohia ana');
  await expect(page.locator('#full-itinerary')).toHaveAttribute('open','');
  expect(await page.evaluate(()=>localStorage.getItem('along-journeys-v1'))).toBe(savedServices);
  await switchTo(page,'en');
  await expect(page.locator('#step-count')).toHaveText(step);
  await expect(page.locator('#full-itinerary')).toHaveAttribute('open','');
  expect(errors).toEqual([]);
});

test('blocked language storage reports session-only choice without breaking navigation', async ({page}) => {
  await page.addInitScript(()=>{
    const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(key==='along-language-v1')throw Error('Blocked');return original.call(this,key,value);};
  });
  await page.goto('/');await page.locator('#settings-open').click();
  await page.locator('#language-choice').selectOption('mi');
  await expect(page.locator('#language-status')).toContainText('tēnei wā whakamahi anake');
  await expect(page.locator('#language-draft')).toBeVisible();
  await expect(page.locator('#language-draft')).toContainText('generated by AI and may contain mistakes');
  await page.locator('#settings .close-dialog').click();
  await expect(page.locator('#flow-title')).toHaveText('Kei te hiahia haere koe ki hea?');
  await page.reload();await expect(page.locator('html')).toHaveAttribute('lang','en-NZ');
});


test('location failure and form validation are translated and recoverable',async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(success,failure){failure({code:1});}}}));
  await page.goto('/');await switchTo(page,'mi');
  await page.locator('#destination-next').click();
  await expect(page.locator('#form-error')).toHaveText('Kōwhiria he ūnga mai i ngā huatau.');
  await expect(page.locator('#form-error')).toHaveAttribute('lang','mi-NZ');
  await page.locator('#nearby-start').click();
  await page.locator('#location').click();
  await expect(page.locator('#form-error')).toContainText('Kāore i taea te tiki');
  await expect(page.locator('#location')).toBeEnabled();
  await expect(page.locator('#location')).toHaveText('Whakamahia tōku tauwāhi o nāianei');
  await switchTo(page,'en');
  await expect(page.locator('#form-error')).toContainText('Could not get your location');
  await expect(page.locator('#location')).toHaveText('Use my current location');
});
