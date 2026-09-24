import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const {chromium} = await import('@playwright/test');
const sources = new Map();
for (const name of ['isolated-preferences.mjs', 'app-preferences.mjs', 'state.mjs'])
  sources.set('/new/experiments/journey-sync/' + name, await readFile(new URL(name, import.meta.url)));
sources.set('/new/public/preferences.js', await readFile(new URL('../../public/preferences.js', import.meta.url)));
const archive = fileURLToPath(new URL('../../releases/along-device-preview-3805.zip', import.meta.url));
assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'), 'ccfd7943aedd1c2de81ddf2cd13358165c882496024a02346dea973e6ec82119');
const oldFile = path => execFileSync('unzip', ['-p', archive, path]);
const manifestBytes = oldFile('build-info.json');
assert.equal(createHash('sha256').update(manifestBytes).digest('hex'), '2e62dcc2c3860ce523baa52d29aad8f628749732397c00613a795e7ef9fcc320');
const manifest = JSON.parse(manifestBytes);
for (const path of ['experiments/journey-sync/app-preferences.mjs', 'experiments/journey-sync/state.mjs', 'public/preferences.js']) {
  const bytes = oldFile(path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.files[path]);
  sources.set('/old/' + path, bytes);
}
const server = createServer((req, res) => {
  const body = req.url === '/' ? '<!doctype html><title>Planner isolation</title>' : sources.get(req.url);
  res.writeHead(body ? 200 : 404, {'Content-Type': req.url === '/' ? 'text/html' : 'text/javascript'}); res.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const context = await browser.newContext(), old = await context.newPage(), fresh = await context.newPage();
  const url = `http://127.0.0.1:${server.address().port}/`;
  await Promise.all([old.goto(url), fresh.goto(url)]);
  const fixture = await old.evaluate(async () => {
    globalThis.legacy = await import('/old/experiments/journey-sync/app-preferences.mjs');
    const group = 'ab'.repeat(32), point = id => ({id, name: id, lat: -36, lon: 174});
    legacy.writePreferences({learning: false, journeys: [{from: point('Home'), to: point('Work'), saved: true,
      savedRoutes: [{mode: 'bus', route: '70'}], count: 7, hours: Array(24).fill(0), days: Array(7).fill(0), last: 5}]});
    legacy.enableJourneyTracking(group);
    return {group, legacyKey: legacy.preferenceKey, expectedRaw: localStorage.getItem(legacy.preferenceKey)};
  });
  const cutover = await fresh.evaluate(async input => {
    const {isolatePlannerPreferences} = await import('/new/experiments/journey-sync/isolated-preferences.mjs');
    const prefs = await import('/new/experiments/journey-sync/app-preferences.mjs');
    const results = await Promise.all([isolatePlannerPreferences(input), isolatePlannerPreferences(input)]);
    if (results.filter(result => !result.alreadyIsolated).length !== 1) throw Error('duplicate isolation');
    const result = results[0];
    const data = prefs.readPreferences(result.storage); data.journeys[0].savedRoutes = [{mode: 'bus', route: '80'}];
    if (!await prefs.writePlannerPreferences(data, result.storage)) throw Error('isolated planner write failed');
    return {key: result.storage.key, raw: result.storage.getItem(prefs.preferenceKey)};
  }, fixture);
  await old.evaluate(() => {
    const data = legacy.readPreferences(); data.journeys[0].savedRoutes = [{mode: 'bus', route: '75'}];
    if (!legacy.writePreferences(data)) throw Error('old writer failed');
  });
  const verify = async input => {
    const {isolatePlannerPreferences, openIsolatedPlannerStorage} = await import('/new/experiments/journey-sync/isolated-preferences.mjs');
    const {preferenceKey} = await import('/new/experiments/journey-sync/app-preferences.mjs');
    const storage = openIsolatedPlannerStorage(input), inspected = storage.inspectLegacy();
    const retry = await isolatePlannerPreferences(input);
    return {raw: storage.getItem(preferenceKey), source: inspected.sourceRaw, changed: inspected.changed,
      olderRoute: JSON.parse(inspected.currentLegacyRaw).journeys[0].savedRoutes[0].route,
      retry: retry.alreadyIsolated && retry.legacyChangesPending};
  };
  const expected = {raw: cutover.raw, source: fixture.expectedRaw, changed: true, olderRoute: '75', retry: true};
  assert.deepEqual(await fresh.evaluate(verify, fixture), expected);
  await fresh.reload(); assert.deepEqual(await fresh.evaluate(verify, fixture), expected);
  const faults = await fresh.evaluate(async input => {
    const {isolatePlannerPreferences, openIsolatedPlannerStorage} = await import('/new/experiments/journey-sync/isolated-preferences.mjs');
    const refuses = async promise => { if (await promise.then(() => true, () => false)) throw Error('expected refusal'); };
    for (const mode of ['quota', 'stale', 'cancel', 'corrupt', 'late-cancel']) {
      const legacyKey = 'along-isolation-' + mode, key = legacyKey + ':generation-profile-v1';
      localStorage.setItem(legacyKey, input.expectedRaw);
      const abort = new AbortController();
      const storage = {getItem: name => localStorage.getItem(name), setItem(name, value) {
        if (mode === 'quota') throw Error('full'); localStorage.setItem(name, value);
        if (mode === 'late-cancel') abort.abort();
      }};
      if (mode === 'stale') localStorage.setItem(legacyKey, input.expectedRaw + ' ');
      if (mode === 'cancel') abort.abort();
      if (mode === 'corrupt') localStorage.setItem(key, '{}');
      await refuses(isolatePlannerPreferences({...input, legacyKey, storage, signal: abort.signal}));
      if (localStorage.getItem(legacyKey) !== input.expectedRaw + (mode === 'stale' ? ' ' : '')) throw Error('legacy data changed');
      if (mode === 'late-cancel') {
        const retry = await isolatePlannerPreferences({...input, legacyKey});
        if (!retry.alreadyIsolated) throw Error('lost committed isolation');
      } else if (localStorage.getItem(key) !== (mode === 'corrupt' ? '{}' : null)) throw Error('partial isolation');
    }
    // An old uncoordinated writer may edit while the new key is installed. The
    // new copy stays intact and that divergence must be reported immediately.
    const raceKey = 'along-isolation-race'; localStorage.setItem(raceKey, input.expectedRaw);
    const raced = await isolatePlannerPreferences({...input, legacyKey: raceKey, storage: {
      getItem: key => localStorage.getItem(key), setItem(key, value) {
        localStorage.setItem(key, value); localStorage.setItem(raceKey, input.expectedRaw + ' ');
      },
    }});
    if (!raced.legacyChangesPending || raced.storage.inspectLegacy().sourceRaw !== input.expectedRaw) throw Error('lost racing legacy edit');
    // A corrupt isolated copy must never cause an implicit fallback to old data.
    localStorage.setItem('along-isolation-corrupt:generation-profile-v1', '{}');
    try { openIsolatedPlannerStorage({...input, legacyKey: 'along-isolation-corrupt'}); throw Error('accepted'); }
    catch (error) { if (error.message === 'accepted') throw error; }
    return true;
  }, fixture);
  assert.equal(faults, true);
  console.log('PASS: byte-verified preview 3805 writer in another tab cannot overwrite isolated planner data; its later route edit and the exact predecessor remain reviewable across reload/retry. Quota, stale review, pre/late cancellation and corruption retain data without fallback. Storage primitive only: no app/membership migration flow is mounted.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
