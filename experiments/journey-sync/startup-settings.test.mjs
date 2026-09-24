// Real generated app/bootstrap/identity. Migration records are explicit fixtures;
// generation-migration.test.mjs separately exercises the actual migration writer.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {extname} from 'node:path';
const {chromium, expect} = await import('@playwright/test');
const root = new URL('../../releases/along-experimental-app/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('build-info.json', root)));
assert.equal(manifest.profile, 'along-experimental-app-v1');
const sources = new Map();
for (const [path, hash] of Object.entries(manifest.files)) {
  const bytes = await readFile(new URL(path, root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hash); sources.set('/' + path, bytes);
}
const server = createServer((req, res) => {
  const name = req.url.endsWith('/') ? req.url + 'index.html' : req.url, body = sources.get(name);
  res.writeHead(body ? 200 : 404, {'Content-Type': ({'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.html':'text/html','.json':'application/json','.css':'text/css'})[extname(name)] || 'application/octet-stream'}); res.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const context = await browser.newContext(), page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/public/`);
  const input = await page.evaluate(async () => {
    const wasm = await import('/experiments/tg-pairing/hive_wasm.js'); await wasm.default();
    const store = await (await import('/experiments/tg-pairing/storage.mjs')).openBrowserStorage('along-pairing-lab-v1');
    try {
      const setup = await (await import('/experiments/tg-pairing/software-persona.mjs')).initializeSoftwarePersona({wasm, store});
      const {emptyState} = await import('/experiments/journey-sync/state.mjs');
      const sourceState = emptyState(setup.group);
      await store.compareAndSwapMany([
        {scope:'along-saved-journeys-v1',key:setup.group,expectedRevision:0,value:{format:2,profile:'along-journey-generation-migration-v1',group:setup.group}},
        {scope:'along-saved-journeys-v2',key:setup.group,expectedRevision:0,value:{...sourceState,format:2,generation:0,checkpoint:'0'.repeat(64)}},
        {scope:'along-journey-migration-v1',key:setup.group,expectedRevision:0,value:{format:1,member:setup.member,sourceRevision:0,sourceState,importReceipt:null}},
      ]);
      const prefs = await import('/experiments/journey-sync/app-preferences.mjs');
      const raw = JSON.stringify({learning:false,journeys:[],journeySync:{format:1,group:setup.group,pending:[]}});
      localStorage.setItem(prefs.preferenceKey,raw); return {group:setup.group,raw,key:prefs.preferenceKey};
    } finally {store.close();}
  });
  const open = async () => {
    await page.locator('#settings-open').click();
    await page.getByRole('button',{name:'Share saved journeys with my devices',exact:true}).click();
  };
  await page.reload(); await open();
  await expect(page.getByText('Saved-journey migration needs to finish on this device.',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Start journey connection',exact:true})).toHaveCount(0);
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),input.key),input.raw);
  await page.evaluate(({group,raw,key})=>localStorage.setItem(key+':generation-profile-v1',JSON.stringify({format:1,group,sourceRaw:raw,currentRaw:raw})),input);
  await page.reload(); await open();
  await expect(page.getByText('Connections for this storage version are not enabled yet.',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Start journey connection',exact:true})).toHaveCount(0);
  await page.evaluate(({raw,key})=>localStorage.setItem(key,raw+' '),input);
  await page.getByRole('button',{name:'Check saved-journey recovery',exact:true}).click();
  await expect(page.getByText('An older app copy has additional edits.',{exact:false})).toBeVisible();
  await page.evaluate(({key})=>localStorage.removeItem(key+':generation-profile-v1'),input);
  await page.getByRole('button',{name:'Check saved-journey recovery',exact:true}).click();
  await expect(page.getByText('Saved-journey migration needs to finish on this device.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Back to settings',exact:true}).click();
  await expect(page.locator('#settings')).toBeVisible();
  assert.deepEqual(errors,[]);
  console.log('PASS: generated Settings/bootstrap with actual identity and fixture migration records pauses legacy connections for incomplete/recovered generations, reports later old-tab edits, detects a removed isolated profile and returns to Settings without page errors. Actual migration writer is tested separately.');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
