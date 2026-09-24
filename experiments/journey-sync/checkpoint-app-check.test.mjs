import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
export async function checkCheckpointApp({pages,owner,candidate,share,closeSharing,reviewPlaces,move}){
  const local=page=>page.evaluate(async()=>{
    const {readEnvelope}=await import((window.testExperimentBase ?? '../experiments/') + 'journey-sync/app-preferences.mjs');
    const value=readEnvelope();return {generation:value.sync?.version?.generation??0,journeys:value.data.journeys};
  });
  const before=await Promise.all(pages.map(local));
  for(const page of pages){
    await share(page);
    await page.getByRole('button',{name:'Review sharing recovery',exact:true}).click();
    await page.getByRole('button',{name:'Prepare recovery on this device',exact:true}).click();
    await expect(page.getByRole('button',{name:'Start checkpoint connection',exact:true})).toBeVisible();
  }
  const apply=async page=>{
    await expect(page.getByRole('heading',{name:/^(Choose what to keep|Apply your saved-place choices\?)$/})).toBeVisible();
    for(let n=0;n<256;n++){
      const keep=page.getByRole('button',{name:'Keep this device’s version',exact:true});
      if(!await keep.count())break;
      await keep.click();
    }
    await page.getByRole('button',{name:'Apply choices on this device',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Saved-place choices applied here',exact:true})).toBeFocused();
    await page.getByRole('button',{name:'Back',exact:true}).click();
  };
  await owner.getByRole('button',{name:'Review recovery checkpoint',exact:true}).click();
  await owner.getByRole('button',{name:'Create checkpoint and review my places',exact:true}).click();
  await apply(owner);
  await owner.getByRole('button',{name:'Start checkpoint connection',exact:true}).click();
  await candidate.getByRole('button',{name:'Join checkpoint connection',exact:true}).click();
  await move(owner,candidate,'Journey device message','Review journey device');
  await candidate.getByRole('button',{name:'Connect this device',exact:true}).click();
  await candidate.getByRole('heading',{name:'Send the journey connection request',exact:true}).waitFor();
  await move(candidate,owner,'Journey connection request','Review journey device');
  await owner.getByRole('button',{name:'Connect this device',exact:true}).click();
  await owner.getByRole('heading',{name:'Send the journey connection reply',exact:true}).waitFor();
  await move(owner,candidate,'Journey connection reply','Connect journey devices');
  for(const page of pages)await page.getByRole('button',{name:'Use checkpoint connection',exact:true}).click();
  await owner.setViewportSize({width:320,height:640});
  const send=owner.getByRole('button',{name:'Send checkpoint for review',exact:true});
  await expect(send).toBeVisible();await send.focus();await owner.keyboard.press('Enter');
  await expect(owner.getByText('Your other device confirmed keeping the checkpoint for review.',{exact:false})).toBeVisible();
  assert.equal((await local(candidate)).generation,0,'receipt must not install');
  await candidate.getByRole('button',{name:'Check received saved places',exact:true}).click();
  await expect(candidate.getByRole('heading',{name:'Review received saved places',exact:true})).toBeFocused();
  assert.deepEqual((await new AxeBuilder({page:candidate}).analyze()).violations.map(v=>v.id),[]);
  await candidate.getByRole('button',{name:'Back',exact:true}).click();
  assert.equal((await local(candidate)).generation,0,'Back must not install');
  await candidate.getByRole('button',{name:'Review received saved places',exact:true}).click();
  await candidate.getByRole('button',{name:'Continue to compare my places',exact:true}).click();
  await apply(candidate);
  for(let i=0;i<pages.length;i++){
    await pages[i].reload();await share(pages[i]);
    await expect(pages[i].getByRole('button',{name:'Start checkpoint connection',exact:true})).toBeVisible();
    const after=await local(pages[i]);assert.equal(after.generation,1);
    assert.deepEqual(after.journeys,before[i].journeys,'checkpoint flow preserves saved places, service choices and learning history');
    await expect(pages[i].getByRole('button',{name:'Review received saved places',exact:true})).toHaveCount(0);
  }
  await owner.getByRole('button',{name:'Start journey connection',exact:true}).click();
  await candidate.getByRole('button',{name:'Join journey connection',exact:true}).click();
  await move(owner,candidate,'Journey device message','Review journey device');
  await candidate.getByRole('button',{name:'Connect this device',exact:true}).click();
  await candidate.getByRole('heading',{name:'Send the journey connection request',exact:true}).waitFor();
  await move(candidate,owner,'Journey connection request','Review journey device');
  await owner.getByRole('button',{name:'Connect this device',exact:true}).click();
  await owner.getByRole('heading',{name:'Send the journey connection reply',exact:true}).waitFor();
  await move(owner,candidate,'Journey connection reply','Connect journey devices');
  for(const page of pages){
    await page.getByRole('button',{name:'Use journey connection',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'Saved journey sharing'})).toContainText('confirmed saving this snapshot',{timeout:15000});
    await closeSharing(page);
  }
  await reviewPlaces(owner,'10 Victoria Road Devonport');
  if(!await owner.locator('#date').isVisible())await owner.locator('#journey-preferences > summary').click();
  await owner.locator('#date').fill('2026-09-23');await owner.locator('#time').fill('09:00');await owner.locator('#find').click();
  await expect(owner.locator('.journey-card').first()).toBeVisible({timeout:30000});
  await owner.locator('[data-follow]').first().click();
  const step=await owner.locator('#current-step').textContent();
  await reviewPlaces(candidate,'1 Queen Street Auckland Central');
  await expect(candidate.locator('#save-places')).toHaveAttribute('aria-pressed','true');
  await candidate.locator('#save-places').click();
  await expect.poll(async()=>(await local(owner)).journeys.filter(j=>j.saved).length).toBe(1);
  assert.equal(await owner.locator('#current-step').textContent(),step,'generation receipt replaced the current journey');
  await candidate.locator('#save-places').click();
  await expect.poll(async()=>(await local(owner)).journeys.filter(j=>j.saved).length).toBe(2);
  assert.equal((await local(owner)).generation,1);
  assert.equal(await owner.locator('#current-step').textContent(),step);
  await share(owner);
  await expect(owner.getByRole('button',{name:'Disconnect journey sharing',exact:true})).toBeVisible();
  await owner.getByRole('button',{name:'Disconnect journey sharing',exact:true}).click();
  await closeSharing(owner);
  console.log('PASS: ongoing generation sharing reconnects through Settings after recovery, carries later deletion/re-save into the other planner, and preserves its current journey.');
  console.log('PASS: two-profile Settings migration, issuer checkpoint creation, explicit connection and send, authenticated receipt without installation, recipient Back/review/apply, accessibility check and reload preserve saved places, services and local history. Harness copies public signaling; no physical-device claim.');
}
