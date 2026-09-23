// Verify a deployed lab against the reviewed local manifest, then exercise its
// first-use storage UI in an ephemeral browser profile. Never uses an AT key.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const url = new URL(process.argv[2]);
assert.equal(url.protocol, 'https:');
assert.ok(url.pathname.endsWith('/'));
const root = new URL('../releases/along-pairing-lab/', import.meta.url);
const local = JSON.parse(await readFile(new URL('build-info.json', root), 'utf8'));
const retrieve = async name => {
  const target = new URL(name, url); target.searchParams.set('lab', local.build_id);
  const response = await fetch(target, {redirect: 'error'});
  assert.equal(response.status, 200, name);
  return Buffer.from(await response.arrayBuffer());
};
assert.deepEqual(JSON.parse((await retrieve('build-info.json')).toString()), local);
const queue = Object.entries(local.files);
await Promise.all(Array.from({length: 4}, async () => {
  while (queue.length) {
    const [name, hash] = queue.pop();
    assert.equal(createHash('sha256').update(await retrieve(name)).digest('hex'), hash, name);
  }
}));
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
try {
  const context = await browser.newContext();
  const unexpected = [], errors = [];
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === url.origin) return route.continue();
    unexpected.push(new URL(route.request().url()).origin); return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url.href);
  assert.equal(await page.locator('#lab-build').textContent(), 'Lab build ' + local.build_id);
  await page.getByRole('button', {name: 'Set up this test device', exact: true}).click();
  await page.getByRole('button', {name: 'Create my device group', exact: true}).click();
  await page.getByRole('button', {name: 'Restore saved test device', exact: true}).click();
  await page.getByRole('button', {name: 'Invite my other device', exact: true}).waitFor();
  await page.reload();
  await page.getByRole('button', {name: 'Restore saved test device', exact: true}).click();
  await page.getByRole('button', {name: 'Invite my other device', exact: true}).waitFor();
  assert.deepEqual(unexpected, []);
  assert.deepEqual(errors, []);
  console.log(`PASS deployed lab ${local.build_id}: all ${Object.keys(local.files).length} payload hashes, HTTPS first-use identity setup and reload/restore; no external provider requests. Physical pairing remains untested.`);
} finally { await browser.close(); }
