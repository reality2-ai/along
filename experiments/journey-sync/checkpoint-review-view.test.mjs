// Presentation tests with an explicit writer fixture; not durable recovery evidence.
import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const {chromium, expect} = await import('@playwright/test');
const sources = new Map();
for (const name of ['state.mjs', 'checkpoint-review-view.mjs']) sources.set('/' + name, await readFile(new URL(name, import.meta.url)));
sources.set('/comparison.css', await readFile(new URL('../tg-pairing/comparison.css', import.meta.url)));
const server = createServer((req, res) => {
  const body = req.url === '/' ? '<!doctype html><html lang="en"><head><title>Journey recovery review</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/comparison.css"></head><body><main><h1>Saved journeys</h1><div id="review"></div></main></body></html>' : sources.get(req.url);
  res.writeHead(body ? 200 : 404, {'Content-Type': req.url === '/' ? 'text/html' : req.url.endsWith('.css') ? 'text/css' : 'text/javascript'}); res.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const context = await browser.newContext({viewport: {width: 320, height: 720}, reducedMotion: 'reduce'});
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async () => {
    const {showCheckpointReview} = await import('./checkpoint-review-view.mjs');
    const {JourneyCapacityError} = await import('./state.mjs');
    const value = (to, route) => ({from: {name: '277 Broadway, Newmarket'}, to: {name: to}, savedRoutes: [{mode: 'bus', route}]});
    globalThis.mount = (mode = 'normal') => {
      globalThis.applied = []; globalThis.left = []; globalThis.receivedSignal = null;
      const differences = mode === 'empty' ? [] : [
        {id: 'route', local: value('1 Queen Street', '75'), shared: value('1 Queen Street', '70')},
        {id: 'deleted', local: null, shared: value('10 Victoria Road, Devonport', '814')},
      ];
      const review = {id: 'review-fixture', differences, resolve(choices) {
        if (choices.length !== differences.length) throw Error('Missing choice');
        if (mode === 'capacity') throw new JourneyCapacityError();
        return {changes: choices};
      }};
      globalThis.view = showCheckpointReview(document.querySelector('#review'), {review, focus: true,
        onBack: retained => { left.push(retained); document.querySelector('#review').textContent = 'Returned to settings'; },
        onConfirm: async ({reviewId, choices, signal}) => {
          applied.push(choices); globalThis.receivedSignal = signal;
          if (mode === 'pending') await new Promise(resolve => { globalThis.finish = resolve; });
          if (mode === 'failure') throw Error('unconfirmed');
          return {status: 'journey-recovery-applied-locally', reviewId};
        }});
    };
    mount();
  });
  const local = page.getByRole('button', {name: 'Keep this device’s version', exact: true});
  const shared = page.getByRole('button', {name: 'Use shared version', exact: true});
  const apply = page.getByRole('button', {name: 'Apply choices on this device', exact: true});
  await expect(page.getByRole('heading', {name: 'Choose what to keep'})).toBeFocused();
  await page.evaluate(() => document.documentElement.style.fontSize = '200%');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
  assert.equal(await local.evaluate(b => {
    const panel = b.closest('section'), css = getComputedStyle(panel);
    return Math.abs(b.getBoundingClientRect().width - (panel.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight))) < 1;
  }), true);
  await local.evaluate(button => button.click()); await expect(page.getByText('Journey 1 of 2', {exact: true})).toBeVisible();
  await local.focus(); await page.keyboard.press('Enter'); await expect(page.getByText('Journey 2 of 2', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Back', exact: true}).click(); await expect(local).toHaveAttribute('aria-pressed', 'true');
  await local.click(); await expect(page.getByText('This device: Not saved', {exact: true})).toBeVisible();
  await shared.click(); await page.getByText('Review all choices', {exact: true}).click();
  await expect(page.getByRole('list')).toContainText('Bus 75'); await expect(page.getByRole('list')).toContainText('Bus 814');
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
  await apply.evaluate(button => button.click()); assert.equal(await page.evaluate(() => applied.length), 0);
  await apply.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', {name: 'Saved-place choices applied here'})).toBeFocused();
  assert.deepEqual(await page.evaluate(() => applied), [[{id: 'route', use: 'local'}, {id: 'deleted', use: 'shared'}]]);
  await page.evaluate(() => mount()); await local.click(); await page.keyboard.press('Escape');
  assert.deepEqual(await page.evaluate(() => left[0].choices), [{id: 'route', use: 'local'}]);
  assert.equal(await page.evaluate(() => applied.length), 0);
  await page.evaluate(() => mount('capacity')); await local.click(); await local.click();
  await expect(apply).toBeDisabled(); await expect(page.getByRole('status')).toContainText('exceed the sharing limit');
  await expect(page.getByRole('button', {name: 'Back', exact: true})).toBeEnabled();
  await page.evaluate(() => mount('failure')); await local.click(); await shared.click(); await apply.click();
  await expect(page.getByRole('status')).toContainText('could not be confirmed'); await expect(apply).toBeDisabled();
  await page.evaluate(() => mount('pending')); await local.click(); await shared.click(); await apply.click();
  await expect(page.getByRole('status')).toContainText('Checking and saving');
  await page.getByRole('button', {name: 'Leave review', exact: true}).click();
  assert.equal(await page.evaluate(() => receivedSignal.aborted), true);
  await page.evaluate(async () => { finish(); await new Promise(resolve => setTimeout(resolve, 0)); });
  await expect(page.locator('#review')).toHaveText('Returned to settings');
  await page.evaluate(() => mount('empty')); await expect(page.getByText('Your retained saved places agree with the shared version.', {exact: false})).toBeVisible();
  await apply.click(); await expect(page.getByRole('heading', {name: 'Saved-place choices applied here'})).toBeFocused();
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
  console.log('PASS: one-journey review, explicit choices, Back/Escape retention, keyboard focus, full-width controls, 320px/200% reflow and axe; capacity/failure/empty states, synthetic-click refusal and late completion after leaving. Writer is a fixture, not durable recovery.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
