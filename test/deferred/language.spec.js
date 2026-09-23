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
  await expect(page.locator('[data-screen=origin]')).toHaveAttribute('aria-label','Kōwhiria he wāhi tīmatanga');
  await expect(page.locator('.flow-nav')).toHaveAttribute('aria-label','Whakatere haerenga');
  await expect(page.locator('#course-notice > summary')).toContainText('He mahi akoranga');
  await page.locator('#course-notice > summary').click();
  await expect(page.locator('#course-notice a')).toHaveAttribute('href','https://at.govt.nz/bus-train-ferry/journey-planner');
  await expect(page.locator('#course-notice a')).toContainText('Tirohia ki AT');
  await page.locator('#course-notice > summary').click();
  await expect(page.locator('label[for=origin]')).toContainText('Wāhi tīmatanga');
  await expect(page.locator('#language-notice')).toBeVisible();
  await choose(page,'origin','277 Broadway Newmarket');
  await page.locator('#origin-next').click();
  await expect(page.locator('#flow-title')).toHaveText('Arotakengia tō haerenga');
  await page.locator('#journey-preferences > summary').click();
  await expect(page.locator('.modes')).toContainText('Waka kōpiko');
  await expect(page.locator('#access-help')).toContainText('Kāore ngā raraunga AT');
  await expect(page.locator('#access-help a')).toHaveAttribute('href','https://at.govt.nz/bus-train-ferry/accessible-travel');
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
  await expect(page.locator('#data-status')).toHaveText(/^(Along · kua rite mō te tuimotu|Tuimotu · kua rite ngā haerenga)$/,{timeout:60000});
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
  const savedAnnouncement=await page.locator('#announcement').textContent();
  expect(savedAnnouncement).toContain('Train S-C');
  await page.locator('#full-itinerary > summary').click();
  const step=await page.locator('#step-count').textContent();
  await switchTo(page,'mi');
  await expect(page.locator('#step-count')).toContainText('Hipanga');
  await expect(page.locator('#announcement')).toContainText('Tereina S-C');
  await expect(page.locator('#announcement')).not.toContainText('Train');
  await expect(page.locator('#itinerary-legs')).toContainText('Ngā tohutohu hīkoi');
  await expect(page.locator('#prefer-services')).toContainText('Ngā ratonga e manakohia ana');
  await expect(page.locator('#full-itinerary')).toHaveAttribute('open','');
  expect(await page.evaluate(()=>localStorage.getItem('along-journeys-v1'))).toBe(savedServices);
  await switchTo(page,'en');
  await expect(page.locator('#step-count')).toHaveText(step);
  await expect(page.locator('#announcement')).toHaveText(savedAnnouncement);
  await expect(page.locator('#full-itinerary')).toHaveAttribute('open','');
  // Saved cards and their service sequence remain usable after offline reopening.
  await page.reload();
  await expect(page.locator('#data-status')).toHaveText(/^(Along · offline ready|Offline · journeys ready)$/,{timeout:90000});
  const card=page.locator('[data-usual]').filter({hasText:'1 Queen Street'}).first();
  await expect(card).toBeVisible();
  await expect(card).toContainText('Saved ·');
  await card.evaluate(node=>{window.savedCardNode=node;});
  await switchTo(page,'mi');
  await expect(card).toContainText('Kua tiakina');
  await expect(card).toContainText('Mai i');
  expect(await card.evaluate(node=>node===window.savedCardNode)).toBe(true);
  await card.click();
  await expect(page.locator('#saved-route-context')).toBeVisible({timeout:30000});
  await expect(page.locator('#saved-route-context')).toContainText('Manakohanga kua tiakina:');
  const services=await page.locator('#saved-route-context').textContent();
  await switchTo(page,'en');
  await expect(page.locator('#saved-route-context')).toContainText('Saved preference:');
  await switchTo(page,'mi');
  await expect(page.locator('#saved-route-context')).toHaveText(services);
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('along-journeys-v1')));
  const before=JSON.parse(savedServices);
  const savedRoutes=data=>Object.fromEntries(data.journeys.filter(j=>j.saved).map(j=>[JSON.stringify([j.from.id,j.to.id]),j.savedRoutes]));
  expect(savedRoutes(after)).toEqual(savedRoutes(before));
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


test('Māori route and stop exploration retains filters and cached Back offline',async({page,context})=>{
  await page.goto('/');await expect(page.locator('#data-status')).toContainText('offline ready',{timeout:90000});
  await switchTo(page,'mi');await context.setOffline(true);
  await page.locator('#browse-routes').click();
  await expect(page.locator('#detail-title')).toHaveText('Tūhuratia he ara');
  await page.locator('#route-search').fill('70');await page.locator('#route-search-results button').first().click();
  await expect(page.locator('#detail-title')).toHaveText('Ngā taipitopito ara');
  await page.locator('#detail-body > .route-variant').first().click();
  await expect(page.locator('#map-streets')).toContainText('Whakaaturia te mahere tiriti');
  await expect(page.locator('#map-streets strong > span')).toHaveCSS('font-size','16px');
  await expect(page.locator('.leaflet-control-zoom-in')).toHaveAttribute('aria-label','Topa mai');
  await page.locator('#route-stop-filter').fill('Symonds');
  await expect(page.locator('#route-match-status')).toContainText('ngā tūnga e hāngai ana');
  await page.locator('.route-stop-list li:visible [data-detail]').first().click();
  await expect(page.locator('#detail-body')).toContainText('Ngā wehenga mai i');
  await expect(page.locator('.departure-board caption')).toHaveText('Ngā wehenga kua whakaritea — ehara i te wā tūturu');
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.locator('#detail-back').click();
  await expect(page.locator('#route-stop-filter')).toHaveValue('symonds');
  await expect(page.locator('#map-streets')).toContainText('Whakaaturia te mahere tiriti');
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  await expect(page.locator('#route-search')).toHaveValue('70');
  await page.keyboard.press('Escape');await switchTo(page,'en');
  await expect(page.locator('#flow-title')).toHaveText('Where would you like to go?');
});

test('Māori Settings retains privacy explanations and working learning controls',async({page})=>{
  await page.setViewportSize({width:320,height:780});await page.goto('/');
  await page.locator('#settings-open').click();await page.locator('#language-choice').selectOption('mi');
  await expect(page.locator('#settings h2')).toHaveText('Tō haerenga, tō mana whakahaere.');
  await expect(page.locator('#settings')).toContainText('Ka noho ō rapunga');
  await expect(page.locator('#language-draft')).toContainText('generated by AI and may contain mistakes');
  await page.locator('#learning-enabled').uncheck();await expect(page.locator('#learning-note')).toContainText('Kua whakatārewatia');
  await page.locator('#course-details > summary').click();await expect(page.locator('#course-details a')).toHaveCount(3);
  await expect(page.locator('#course-details')).toContainText('Kāore te tangata e mate ki te tuhi waehere');
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  expect(await page.locator('#settings').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.locator('#clear-history').click();await expect(page.locator('#storage-message')).toHaveText('Kua mukua tō hītori haerenga me ō ara kua tiakina.');
  await page.locator('#language-choice').selectOption('en');await expect(page.locator('#learning-note')).toContainText('Journey learning is paused');
  await expect(page.locator('#storage-message')).toHaveText('Your journey history and saved routes have been cleared.');
  await expect(page.locator('#learning-enabled')).not.toBeChecked();
});

test('nearby comparisons retain scheduled labels and controls in Māori offline',async({page,context})=>{
  await page.goto('/');await expect(page.locator('#data-status')).toContainText('offline ready',{timeout:90000});
  await switchTo(page,'mi');await context.setOffline(true);
  await page.locator('#nearby-start').click();await choose(page,'origin','Waitemata Train');
  await page.locator('#origin-next').click();await page.locator('#find').click();
  await expect(page.locator('#departures .stop-card').first()).toBeVisible({timeout:30000});
  await expect(page.locator('#departures')).toContainText('Kua whakaritea');
  await expect(page.locator('#departures')).not.toContainText('● Matapae o nāianei');
  await page.locator('#nearby-panel .journey-notes > summary').click();
  await expect(page.locator('#nearby-note')).toContainText('kāore ngā whakahoutanga wā-tūturu e hono ana');
  await switchTo(page,'en');await expect(page.locator('#departures')).toContainText('Scheduled');
  await expect(page.locator('#nearby-note')).toContainText('live updates are not connected');
  await page.locator('#refresh').click();await expect(page.locator('#refresh')).toBeEnabled();
  await expect(page.locator('#departures .stop-card').first()).toBeVisible();
});


test('offline readiness and failed manual refresh keep their actual language',async({page,context})=>{
  await page.goto('/');await expect(page.locator('#data-status')).toContainText('offline ready',{timeout:90000});
  await switchTo(page,'mi');await page.locator('#settings-open').click();
  await expect(page.locator('#data-status')).toHaveText('Along · kua rite mō te tuimotu');
  await expect(page.locator('#address-status')).toHaveText('Kua rite ngā wāhitau me ngā ara hīkoi mō te whakamahi tuimotu.');
  await expect(page.locator('#offline-info')).toContainText('Ka whakahaeretia katoatia te rapu ara ā-wātaka');
  await context.setOffline(true);await expect(page.locator('#data-status')).toHaveText('Tuimotu · kua rite ngā haerenga');
  await page.locator('#update-timetable').click();await expect(page.locator('#update-timetable')).toBeEnabled();
  await expect(page.locator('#offline-info')).toHaveAttribute('lang','en-NZ');
  await expect(page.locator('#offline-info')).not.toContainText('Kei te tikiake');
  await page.locator('#language-choice').selectOption('en');
  await expect(page.locator('#data-status')).toHaveText('Offline · journeys ready');
  await expect(page.locator('#offline-info')).not.toContainText('Downloading the latest');
  await page.locator('#settings .close-dialog').click();
  await choose(page,'destination','Waitemata Train');await page.locator('#destination-next').click();
  await expect(page.locator('#origin')).toBeVisible();
});


test('worker validation translates across language switches and a corrected search succeeds',async({page})=>{
  await page.goto('/');await expect(page.locator('#data-status')).toContainText('offline ready',{timeout:90000});
  await switchTo(page,'mi');
  await choose(page,'destination','Waitemata Train');await page.locator('#destination-next').click();
  await choose(page,'origin','Newmarket Train');await page.locator('#origin-next').click();
  await page.locator('#journey-preferences > summary').click();
  await page.locator('#date').fill('2030-01-01');await page.locator('#time').fill('09:00');
  await page.locator('#find').click();
  await expect(page.locator('#form-error')).toContainText('Kei waho tēnei rā');
  await expect(page.locator('#form-error')).toHaveAttribute('lang','mi-NZ');
  await switchTo(page,'en');await expect(page.locator('#form-error')).toContainText('outside the downloaded timetable');
  await page.locator('#date').fill('2026-09-23');await page.locator('#find').click();
  await expect(page.locator('.journey-card').first()).toBeVisible({timeout:30000});
  await expect(page.locator('#form-error')).toBeEmpty();
});

test('installation guide follows the offline language choice and preserves platform disclosure',async({page,context})=>{
  await page.goto('/');
  await expect(page.locator('#data-status')).toContainText('offline ready',{timeout:90000});
  await switchTo(page,'mi');
  await context.setOffline(true);
  await page.goto('/install.html');
  await expect(page.locator('h1:visible')).toHaveText('Tāutahia a Along, ka whakamahi tuimotu');
  await expect(page.locator('#guide-draft')).toBeVisible();
  const mi=page.locator('[data-guide-language=mi]');
  await expect(mi).toContainText('Kāore e whakaatu i ngā tauwāhi pahi');
  await expect(mi).toContainText('Ka noho ō rapunga haerenga');
  await expect(mi.locator('details')).toHaveCount(9);
  const android=mi.locator('details').filter({has:page.locator('summary', {hasText:'Chrome — waea, papa rānei Android'})});
  await android.locator('summary').click();
  await expect(android).toContainText('Install and create shortcut');
  await page.setViewportSize({width:320,height:800});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.locator('#guide-language-choice').focus();
  await page.locator('#guide-language-choice').selectOption('en');
  await expect(page.locator('#guide-language-choice')).toBeFocused();
  await expect(page.locator('h1:visible')).toHaveText('Install Along and use it offline');
  const en=page.locator('[data-guide-language=en]');
  await expect(en.locator('details').filter({hasText:'Chrome — Android phone or tablet'})).toHaveAttribute('open','');
  expect(await mi.locator('a').evaluateAll(els=>els.map(el=>el.getAttribute('href')).sort())).toEqual(await en.locator('a').evaluateAll(els=>els.map(el=>el.getAttribute('href')).sort()));
  await page.locator('#guide-language-choice').selectOption('mi');
  await page.reload();
  await expect(page.locator('h1:visible')).toContainText('Tāutahia');
  await page.locator('#guide-back').click();
  await expect(page.locator('#flow-title')).toHaveText('Kei te hiahia haere koe ki hea?');
});

test('installation help remains readable if its language script fails',async({page})=>{
  await page.route('**/install-guide.js',route=>route.abort());
  await page.goto('/install.html');
  await expect(page.locator('h1:visible')).toHaveText('Install Along and use it offline');
  await expect(page.locator('#guide-language')).toBeHidden();
  await expect(page.locator('[data-guide-language=en] details')).toHaveCount(9);
  await expect(page.locator('#guide-back')).toHaveAttribute('href','./');
});
