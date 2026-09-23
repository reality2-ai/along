// Generated journey app in two isolated profiles. Real UI enrollment and saved
// places; the harness copies public connection text. No AT key or provider needed.
import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join, extname} from 'node:path';
const {chromium, expect} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const mainSetup = true;
const root = new URL('../../releases/along-experimental-app/', import.meta.url).pathname;
const manifest = JSON.parse(await readFile(join(root, 'build-info.json'), 'utf8'));
assert.equal(manifest.profile, 'along-experimental-app-v1');
assert.equal(Object.keys(manifest.files).some(name => /APIKey|\.test\./.test(name)), false);
const sources = new Map(await Promise.all(Object.entries(manifest.files).map(async ([name, hash]) => {
  const bytes = await readFile(join(root, name));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hash); return [name, bytes];
})));
const prefix = '/along-exp/';
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const name = path.startsWith(prefix) ? path.slice(prefix.length) + (path.endsWith('/') ? 'index.html' : '') : '';
  const body = sources.get(name);
  if (!body) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', ({'.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.css': 'text/css', '.gz': 'application/gzip', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml'})[extname(name)] || 'text/plain');
  res.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const origin = `http://127.0.0.1:${server.address().port}${prefix}`;
  const providerRequests = [], errors = [];
  for (const page of pages) page.on('pageerror', error => errors.push(error.message));
  for (const context of contexts) await context.route('https://api.at.govt.nz/**', async route => { providerRequests.push(route.request().url()); await route.abort(); });
  const restoreSetup = async page => {
    if (mainSetup) {
      const setup = page.getByRole('dialog', {name: 'Device and AT-key setup', exact: true});
      if (!await setup.isVisible()) {
        await page.locator('#settings-open').click();
        await page.getByRole('button', {name: 'Device and AT-key setup', exact: true}).click();
      }
      await page.getByRole('heading', {name: 'Your devices and AT key', exact: true}).waitFor();
    } else await page.getByRole('button', {name: 'Restore saved test device', exact: true}).click();
  };
  await Promise.all(pages.map(async (page, index) => {
    await page.goto(origin + (mainSetup ? 'public/' : 'experiments/'));
    if (mainSetup) {
      await page.locator('#settings-open').click();
      await page.getByRole('button', {name: 'Device and AT-key setup', exact: true}).click();
    }
    await page.getByRole('button', {name: mainSetup ? 'Set up my device' : 'Set up this test device', exact: true}).click();
    await page.getByRole('button', {name: 'Create my device group', exact: true}).click();
    await restoreSetup(page);
    if (mainSetup) await page.getByText('Connect or recover another device', {exact: true}).click();
    await page.getByRole('button', {name: index ? 'Invite my other device' : 'Join my other device', exact: true}).click();
  }));
  const [candidate, owner] = pages;
  await owner.getByRole('heading', {name: 'Invite your other device', exact: true}).waitFor();
  const move = async (from, to, label, action) => {
    const text = await from.getByLabel('Device message to copy').inputValue();
    await to.getByLabel(label, {exact: true}).fill(text);
    await to.getByRole('button', {name: action, exact: true}).click();
  };
  await move(owner, candidate, 'Invitation text', 'Review invitation');
  await candidate.getByRole('button', {name: 'Use invitation from my other device', exact: true}).click();
  await candidate.getByRole('heading', {name: 'Check your other device', exact: true}).waitFor();
  await move(candidate, owner, 'Challenge from your other device', 'Create device reply');
  await owner.getByRole('heading', {name: 'Send your device reply', exact: true}).waitFor();
  await move(owner, candidate, 'Reply from your other device', 'Check reply');
  await candidate.getByRole('heading', {name: 'Send connection details', exact: true}).waitFor();
  await move(candidate, owner, 'Connection details from your other device', 'Prepare connection');
  await owner.getByRole('heading', {name: 'Send the connection reply', exact: true}).waitFor();
  await move(owner, candidate, 'Connection reply from your other device', 'Compare device codes');
  await owner.getByRole('button', {name: 'Compare device codes', exact: true}).click();
  await Promise.all(pages.map(page => page.getByRole('heading', {name: 'Do both devices show this code?', exact: true}).waitFor()));
  assert.equal(await candidate.locator('.pairing-code').textContent(), await owner.locator('.pairing-code').textContent());

  await Promise.all(pages.map(async page => {
    await page.getByRole('button', {name: 'Both devices are here and the codes match', exact: true}).click();
  }));
  await candidate.getByRole('heading', {name: 'Device connected', exact: true}).waitFor();
  await owner.getByRole('heading', {name: 'Other device installed', exact: true}).waitFor();

  await Promise.all(pages.map(page => page.reload()));
  const preferences = page => page.evaluate(() => JSON.parse(localStorage.getItem('along-journeys-v1')));
  const saved = async page => (await preferences(page)).journeys.filter(j => j.saved);
  const choose = async (page, field, query) => {
    await expect(page.locator('#address-status')).toContainText('ready offline', {timeout: 60000});
    const input = page.locator('#' + field); await input.fill(query);
    await expect(page.locator('#' + field + '-options [data-index]').first()).toBeVisible({timeout: 30000});
    await input.press('ArrowDown'); await input.press('Enter');
  };
  const savePlaces = async (page, destination) => {
    await choose(page, 'destination', destination); await page.locator('#destination-next').click();
    await choose(page, 'origin', '277 Broadway Newmarket'); await page.locator('#origin-next').click();
    await page.locator('#save-places').click();
    await expect(page.locator('#save-places')).toHaveAttribute('aria-pressed', 'true');
  };
  await savePlaces(owner, '10 Victoria Road Devonport');
  await owner.locator('#journey-preferences > summary').click();
  await owner.locator('#date').fill('2026-09-23'); await owner.locator('#time').fill('09:00'); await owner.locator('#find').click();
  await expect(owner.locator('.journey-card').first()).toBeVisible({timeout: 30000});
  await owner.locator('[data-follow]').first().click(); await owner.locator('#prefer-services').click();
  const originalStep = await owner.locator('#current-step').textContent();
  const preferred = (await saved(owner))[0]; assert.ok(preferred.savedRoutes.length);
  await savePlaces(candidate, '1 Queen Street Auckland Central');
  const share = async page => {
    await page.locator('#settings-open').click();
    await page.getByRole('button', {name: 'Share saved journeys with my devices', exact: true}).click();
  };
  const closeSharing = async page => {
    await page.getByRole('button', {name: 'Back to settings', exact: true}).click();
    await page.getByRole('button', {name: 'Close settings', exact: true}).click();
  };
  const connectJourneys = async () => {
    await Promise.all(pages.map(share));
    await owner.getByRole('button', {name: 'Start journey connection', exact: true}).click();
    await candidate.getByRole('button', {name: 'Join journey connection', exact: true}).click();
    await move(owner, candidate, 'Journey device message', 'Review journey device');
    await candidate.getByRole('button', {name: /^(Allow journey sharing|Connect this device)$/}).click();
    await candidate.getByRole('heading', {name: 'Send the journey connection request', exact: true}).waitFor();
    await move(candidate, owner, 'Journey connection request', 'Review journey device');
    await owner.getByRole('button', {name: /^(Allow journey sharing|Connect this device)$/}).click();
    await owner.getByRole('heading', {name: 'Send the journey connection reply', exact: true}).waitFor();
    await move(owner, candidate, 'Journey connection reply', 'Connect journey devices');
    for (const page of pages) {
      await page.getByRole('button', {name: 'Use journey connection', exact: true}).click();
      await expect(page.getByRole('dialog', {name: 'Saved journey sharing'})).toContainText('confirmed saving this snapshot', {timeout: 15000});
      await closeSharing(page);
    }
  };
  await connectJourneys();
  await expect.poll(async () => (await saved(candidate)).length).toBe(2);
  await expect.poll(async () => (await saved(owner)).length).toBe(2);
  assert.deepEqual((await saved(candidate)).find(j => j.to.id === preferred.to.id).savedRoutes, preferred.savedRoutes);
  assert.equal((await saved(candidate)).find(j => j.to.id === preferred.to.id).count, 0, 'owner learning history stays local');
  assert.equal(await owner.locator('#current-step').textContent(), originalStep, 'receipt preserves current journey');
  await candidate.locator('#save-places').click();
  await expect(candidate.locator('#save-places')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await saved(owner)).length).toBe(1);
  assert.equal(await owner.locator('#current-step').textContent(), originalStep);
  await owner.setViewportSize({width: 320, height: 640});
  await owner.evaluate(() => document.documentElement.style.fontSize = '200%');
  await share(owner);
  assert.equal(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual((await new AxeBuilder({page: owner}).analyze()).violations.map(v => v.id), []);
  await owner.getByRole('button', {name: 'Disconnect journey sharing', exact: true}).click(); await closeSharing(owner);
  await Promise.all(pages.map(page => expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)));
  await Promise.all(contexts.map(context => context.setOffline(true)));
  await Promise.all(pages.map(page => page.reload()));
  await owner.locator('#settings-open').click(); await owner.locator('#clear-history').click();
  await owner.getByRole('button', {name: 'Close settings', exact: true}).click();
  await savePlaces(candidate, 'University of Auckland');
  const candidateNew = (await saved(candidate)).find(j => j.to.id !== preferred.to.id);
  assert.ok(candidateNew);
  await Promise.all(contexts.map(context => context.setOffline(false)));
  await connectJourneys();
  await expect.poll(async () => (await saved(candidate)).map(j => j.to.id)).toEqual([candidateNew.to.id]);
  await expect.poll(async () => (await saved(owner)).map(j => j.to.id)).toEqual([candidateNew.to.id]);
  assert.equal(providerRequests.length, 0); assert.deepEqual(errors, []);
  console.log('PASS: actual Settings enrollment/connection, saved places and service preferences, independent local history, live local edits, current-step preservation, narrow/zoom accessibility, offline reopening and save/removal convergence. Two browser profiles on one host; manual message transfer, not physical reachability or automatic discovery.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
