import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import('@playwright/test');
const sources = new Map();
for (const name of ['state.mjs', 'store.mjs', 'generation-state.mjs', 'generation-migration.mjs', 'generation-app-store.mjs', 'app-preferences.mjs', 'generation-checkpoint.mjs', 'checkpoint-preparation.mjs', 'checkpoint-installation.mjs', 'checkpoint-review.mjs', 'checkpoint-choice-commit.mjs'])
  sources.set('/journey-sync/' + name, await readFile(new URL(name, import.meta.url)));
sources.set('/public/preferences.js', await readFile(new URL('../../public/preferences.js', import.meta.url)));
for (const name of ['software-persona.mjs', 'local-persona.mjs'])
  sources.set('/tg-pairing/' + name, await readFile(new URL('../tg-pairing/' + name, import.meta.url)));
for (const name of ['storage.mjs', 'membership.mjs', 'certificate.mjs'])
  sources.set('/tg-pairing/' + name, await readFile(join(process.env.R2_BROWSER_DIR, name)));
for (const name of ['hive_wasm.js', 'hive_wasm_bg.wasm']) sources.set('/' + name, await readFile(join(process.env.R2_WASM_DIR, name)));
const server = createServer((req, res) => {
  const body = req.url === '/' ? '<!doctype html><title>Journey migration</title>' : sources.get(req.url);
  res.writeHead(body ? 200 : 404, {'Content-Type': req.url.endsWith('.wasm') ? 'application/wasm' : req.url === '/' ? 'text/html' : 'text/javascript'}); res.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const context = await browser.newContext();
  const page = await context.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async () => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const {openBrowserStorage} = await import('./tg-pairing/storage.mjs');
    const {initializeSoftwarePersona} = await import('./tg-pairing/software-persona.mjs');
    const {emptyState, changeJourney, journeyId, projectJourney} = await import('./journey-sync/state.mjs');
    const {openJourneyStore} = await import('./journey-sync/store.mjs');
    const {migrateJourneyGeneration} = await import('./journey-sync/generation-migration.mjs');
    const assert = (v, message) => { if (!v) throw Error(message); };
    const refuses = async promise => assert(await promise.then(() => false, () => true), 'expected refusal');
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const oldScope = 'along-saved-journeys-v1', newScope = 'along-saved-journeys-v2', archiveScope = 'along-journey-migration-v1';
    const place = id => ({id, name: id, lat: -36, lon: 174});
    const live = projectJourney({from: place('from'), to: place('to')});
    async function fixture(name, empty = false) {
      const store = await openBrowserStorage(name), setup = await initializeSoftwarePersona({wasm, store});
      const group = Uint8Array.from(setup.group.match(/../g), n => parseInt(n, 16));
      let state = changeJourney(emptyState(setup.group), setup.member, journeyId(live), live);
      state = changeJourney(state, setup.member, JSON.stringify(['stop', 'from', 'stop', 'gone']), null);
      if (!empty) {
        await store.compareAndSwap(oldScope, setup.group, 0, state);
        await store.compareAndSwap('along-journey-import-v1', setup.group, 0, {format: 1, operation: crypto.randomUUID()});
      }
      return {store, setup, state, input: {wasm, store, expectedGroup: group, expectedRevision: empty ? 0 : 1}};
    }
    const first = await fixture('journey-migration');
    const receipt = await first.store.read('along-journey-import-v1', first.setup.group);
    const pending = JSON.stringify({learning: true, journeys: [{...live, saved: true, count: 7, hours: Array(24).fill(0), days: Array(7).fill(0)}], journeySync: {format: 1, group: first.setup.group,
      pending: [{id: receipt.value.operation, changes: [{id: journeyId(live), value: live}]},
        {id: crypto.randomUUID(), changes: [{id: journeyId(live), value: null}]}]}});
    localStorage.setItem('along-journeys-v1', pending);
    const both = await Promise.all([migrateJourneyGeneration(first.input), migrateJourneyGeneration(first.input)]);
    assert(both.filter(r => !r.alreadyMigrated).length === 1, 'migration committed twice');
    const migrated = await first.store.read(newScope, first.setup.group), archive = await first.store.read(archiveScope, first.setup.group);
    assert(migrated.revision === 1 && migrated.value.generation === 0, 'wrong migrated generation');
    assert(equal(migrated.value.journeys, first.state.journeys), 'migration discarded live values or tombstones');
    assert(equal(archive.value.sourceState, first.state) && equal(archive.value.importReceipt, receipt), 'source/receipt not archived');
    assert(localStorage.getItem('along-journeys-v1') === pending, 'local journal changed');
    await refuses(openJourneyStore({store: first.store, group: first.setup.group, actor: first.setup.member}).save(live));
    await refuses(migrateJourneyGeneration({...first.input, expectedRevision: 2}));
    first.store.close();
    const fresh = await fixture('journey-migration-empty', true);
    await migrateJourneyGeneration(fresh.input);
    assert((await fresh.store.read(newScope, fresh.setup.group)).value.journeys.length === 0, 'empty replica migration');
    assert((await fresh.store.read(archiveScope, fresh.setup.group)).value.importReceipt === null, 'invented import receipt');
    fresh.store.close();
    for (const mode of ['stale', 'permission-race', 'interrupted', 'old-writer', 'cancelled']) {
      const f = await fixture('journey-migration-' + mode);
      const abort = new AbortController(); let input = {...f.input, signal: abort.signal};
      if (mode === 'stale') input.expectedRevision = 0;
      if (mode === 'cancelled') abort.abort();
      if (mode === 'permission-race') input.store = {...f.store, compareAndSwapMany: async (...args) => {
        await f.store.compareAndSwap('along-journey-sharing-v1', f.setup.group, 0, {format: 1, member: f.setup.member, peers: []});
        return f.store.compareAndSwapMany(...args);
      }};
      if (mode === 'old-writer') {
        const older = {...f.store, compareAndSwapMany: async (...args) => {
          await migrateJourneyGeneration(input); return f.store.compareAndSwapMany(...args);
        }};
        await refuses(openJourneyStore({store: older, group: f.setup.group, actor: f.setup.member}).save(live));
        assert(equal((await f.store.read(newScope, f.setup.group)).value.journeys, f.state.journeys), 'old in-flight writer changed migrated replica');
      } else if (mode === 'interrupted') {
        const put = IDBObjectStore.prototype.put; let interrupted = false;
        IDBObjectStore.prototype.put = function(...args) {
          const result = put.apply(this, args);
          if (args[1]?.[0] === newScope) { interrupted = true; this.transaction.abort(); }
          return result;
        };
        try { await refuses(migrateJourneyGeneration(input)); } finally { IDBObjectStore.prototype.put = put; }
        assert(interrupted, 'did not interrupt actual transaction');
      } else await refuses(migrateJourneyGeneration(input));
      if (mode !== 'old-writer') {
        assert(await f.store.read(newScope, f.setup.group) === null && await f.store.read(archiveScope, f.setup.group) === null, 'partial migration');
        assert(equal((await f.store.read(oldScope, f.setup.group)).value, f.state), 'failure changed legacy data');
      }
      f.store.close();
    }
    const {loadSoftwareIssuer} = await import('./tg-pairing/software-persona.mjs');
    const {installJourneyCheckpoint} = await import('./journey-sync/checkpoint-installation.mjs');
    let installationGroup;
    for (const mode of ['valid', 'interrupted', 'permission-race', 'stale', 'changed-local', 'bad-signature', 'late-cancel', 'concurrent-local-edit']) {
      const f = await fixture('checkpoint-install-' + mode);
      await migrateJourneyGeneration(f.input);
      const issuer = await loadSoftwareIssuer({wasm, store: f.store, expectedGroup: f.input.expectedGroup});
      const prepared = await issuer.prepareJourneyCheckpoint({expectedRevision: 1}); issuer.close();
      const raw = JSON.stringify({learning: true, journeys: [{...live, saved: true}],
        journeySync: {format: 1, group: f.setup.group, pending: [{id: crypto.randomUUID(), changes: [{id: journeyId(live), value: null}]}]}});
      const localKey = 'install-' + mode; localStorage.setItem(localKey, raw);
      let expectedRawAfter = raw;
      const local = {getItem: () => localStorage.getItem(localKey), setItem: () => { throw Error('installer must not write preferences'); }};
      const abort = new AbortController();
      let input = {...f.input, expectedRevision: 1, expectedLocalRaw: raw, checkpoint: prepared.checkpoint,
        snapshot: prepared.snapshot, storage: local, signal: abort.signal};
      if (mode === 'stale') input.expectedRevision = 2;
      if (mode === 'bad-signature') { input.checkpoint = input.checkpoint.slice(); input.checkpoint[183] ^= 1; }
      if (mode === 'changed-local') { expectedRawAfter = raw + ' '; localStorage.setItem(localKey, expectedRawAfter); }
      if (mode === 'permission-race') input.store = {...f.store, compareAndSwapMany: async (...args) => {
        await f.store.compareAndSwap('along-journey-sharing-v1', f.setup.group, 0, {format: 1, member: f.setup.member, peers: []});
        return f.store.compareAndSwapMany(...args);
      }};
      if (mode === 'late-cancel' || mode === 'concurrent-local-edit') input.store = {...f.store, compareAndSwapMany: async (...args) => {
        if (mode === 'concurrent-local-edit') {
          const edited = JSON.parse(raw); edited.journeySync.pending.push({id: crypto.randomUUID(), changes: []});
          expectedRawAfter = JSON.stringify(edited); localStorage.setItem(localKey, expectedRawAfter);
        }
        const result = await f.store.compareAndSwapMany(...args);
        if (mode === 'late-cancel') abort.abort(); return result;
      }};
      if (mode === 'interrupted') {
        const put = IDBObjectStore.prototype.put; let interrupted = false;
        IDBObjectStore.prototype.put = function(...args) {
          const result = put.apply(this, args);
          if (args[1]?.[0] === 'along-journey-import-v2') { interrupted = true; this.transaction.abort(); }
          return result;
        };
        try { await refuses(installJourneyCheckpoint(input)); } finally { IDBObjectStore.prototype.put = put; }
        assert(interrupted, 'installer transaction not interrupted');
      } else if (mode === 'valid') {
        const results = await Promise.all([installJourneyCheckpoint(input), installJourneyCheckpoint(input)]);
        assert(results.filter(r => !r.alreadyInstalled).length === 1, 'checkpoint installed twice');
        assert(results.every(r => r.localReviewRequired), 'local differences silently resolved');
        installationGroup = f.setup.group;
      } else if (mode === 'concurrent-local-edit') await installJourneyCheckpoint(input);
      else await refuses(installJourneyCheckpoint(input));
      const current = await f.store.read(newScope, f.setup.group);
      const recovered = await f.store.read('along-journey-checkpoint-recovery-v1', f.setup.group + ':1');
      if (['valid', 'late-cancel', 'concurrent-local-edit'].includes(mode)) {
        assert(current.value.generation === 1 && current.value.journeys.length === 1, 'checkpoint not installed');
        assert(equal(recovered.value.previous.journeys, f.state.journeys) && recovered.value.localRaw === raw, 'recovery copy missing');
        assert((await f.store.read('along-journey-import-v2', f.setup.group)).value.operation === null, 'old receipt carried into new generation');
        const retry = await installJourneyCheckpoint({...input, store: f.store, signal: undefined});
        assert(retry.alreadyInstalled && (await f.store.read(newScope, f.setup.group)).revision === current.revision, 'retry rewrote installation');
        if (mode === 'valid') {
          const corrupt = structuredClone(recovered.value); corrupt.snapshot.journeys[0].value.to.name = 'Damaged retained snapshot';
          await f.store.compareAndSwap('along-journey-checkpoint-recovery-v1', f.setup.group + ':1', recovered.revision, corrupt);
          await refuses(installJourneyCheckpoint(input));
          assert((await f.store.read(newScope, f.setup.group)).revision === current.revision, 'corrupt recovery retry changed replica');
          await f.store.compareAndSwap('along-journey-checkpoint-recovery-v1', f.setup.group + ':1', recovered.revision + 1, recovered.value);
        }
      } else {
        assert(current.revision === 1 && current.value.generation === 0 && recovered === null, 'partial checkpoint installation');
        assert(await f.store.read('along-journey-import-v2', f.setup.group) === null, 'partial new receipt');
      }
      assert(localStorage.getItem(localKey) === expectedRawAfter, 'installer changed preferences');
      if (mode === 'concurrent-local-edit') assert(JSON.parse(localStorage.getItem(localKey)).journeySync.pending.length === 2, 'concurrent local edit lost');
      f.store.close();
    }
    const {createCheckpointReview} = await import('./journey-sync/checkpoint-review.mjs');
    const {commitCheckpointChoices, applyCheckpointChoices, choiceScope} = await import('./journey-sync/checkpoint-choice-commit.mjs');
    let choiceRetry;
    for (const mode of ['valid', 'stale', 'permission-race', 'interrupted', 'late-cancel', 'local-edit']) {
      const f = await fixture('checkpoint-choice-' + mode);
      await migrateJourneyGeneration(f.input);
      const issuer = await loadSoftwareIssuer({wasm, store: f.store, expectedGroup: f.input.expectedGroup});
      const prepared = await issuer.prepareJourneyCheckpoint({expectedRevision: 1}); issuer.close();
      const localValue = {...live, savedRoutes: [{mode: 'bus', route: '75'}]};
      const raw = JSON.stringify({learning: false, journeys: [{...localValue, saved: true, count: 7}],
        journeySync: {format: 1, group: f.setup.group, pending: [{id: crypto.randomUUID(), changes: [{id: journeyId(live), value: localValue}]}]}});
      const localKey = 'choice-' + mode; localStorage.setItem(localKey, raw);
      const storage = {getItem: () => localStorage.getItem(localKey), setItem: () => { throw Error('must not replace local data'); }};
      await installJourneyCheckpoint({...f.input, expectedLocalRaw: raw, checkpoint: prepared.checkpoint, snapshot: prepared.snapshot, storage});
      const replica = await f.store.read(newScope, f.setup.group);
      const recovery = await f.store.read('along-journey-checkpoint-recovery-v1', f.setup.group + ':1');
      const review = await createCheckpointReview({current: replica.value, recovery: recovery.value, localRaw: raw, actor: f.setup.member});
      assert(review.differences.length === 1, 'expected preference difference');
      const abort = new AbortController();
      const input = {wasm, store: f.store, expectedGroup: f.input.expectedGroup, generation: 1, reviewId: review.id,
        choices: [{id: journeyId(live), use: 'local'}], storage, signal: abort.signal};
      let expectedRaw = raw;
      if (mode === 'stale') { expectedRaw += ' '; localStorage.setItem(localKey, expectedRaw); }
      if (['permission-race', 'late-cancel', 'local-edit'].includes(mode)) input.store = {...f.store, compareAndSwapMany: async (...args) => {
        if (mode === 'permission-race') await f.store.compareAndSwap('along-journey-sharing-v1', f.setup.group, 0, {format: 1, member: f.setup.member, peers: []});
        if (mode === 'local-edit') { expectedRaw += ' '; localStorage.setItem(localKey, expectedRaw); }
        const result = await f.store.compareAndSwapMany(...args);
        if (mode === 'late-cancel') abort.abort(); return result;
      }};
      if (mode === 'interrupted') {
        const put = IDBObjectStore.prototype.put; let hit = false;
        IDBObjectStore.prototype.put = function(...args) {
          const result = put.apply(this, args);
          if (args[1]?.[0] === choiceScope) { hit = true; this.transaction.abort(); }
          return result;
        };
        try { await refuses(commitCheckpointChoices(input)); } finally { IDBObjectStore.prototype.put = put; }
        assert(hit, 'decision transaction not interrupted');
      } else if (['stale', 'permission-race', 'late-cancel'].includes(mode)) await refuses(commitCheckpointChoices(input));
      else {
        const results = await Promise.all([commitCheckpointChoices(input), commitCheckpointChoices(input)]);
        assert(results.filter(r => !r.alreadyCommitted).length === 1 && results.every(r => r.localReviewRequired), 'decision repeated or false completion');
      }
      const after = await f.store.read(newScope, f.setup.group);
      const retained = await f.store.read(choiceScope, review.id);
      if (['valid', 'late-cancel', 'local-edit'].includes(mode)) {
        assert(after.value.clock === replica.value.clock + 1 && after.value.journeys[0].value.savedRoutes[0].route === '75', 'chosen preference missing or duplicated');
        assert(retained.value.localRaw === raw && equal(retained.value.before, replica.value), 'original review not retained');
        const retry = {...input, store: f.store, signal: undefined};
        assert((await commitCheckpointChoices(retry)).alreadyCommitted, 'retained retry failed');
        assert((await f.store.read(newScope, f.setup.group)).revision === after.revision, 'retry wrote again');
        await refuses(commitCheckpointChoices({...retry, choices: [{id: journeyId(live), use: 'shared'}]}));
        if (mode === 'valid') choiceRetry = {group: f.setup.group, reviewId: review.id, choices: input.choices};
      } else assert(after.revision === replica.revision && retained === null, 'partial decision');
      assert(localStorage.getItem(localKey) === expectedRaw, 'decision replaced local edits');
      if (['valid', 'late-cancel', 'local-edit'].includes(mode)) {
        const retry = {...input, store: f.store, signal: undefined};
        await refuses(applyCheckpointChoices(retry)); // write denied, or newer local data
        assert(localStorage.getItem(localKey) === expectedRaw, 'failed cutover changed local data');
        const writable = {getItem: () => localStorage.getItem(localKey), setItem: (_, value) => localStorage.setItem(localKey, value)};
        if (mode === 'local-edit') await refuses(applyCheckpointChoices({...retry, storage: writable}));
        else {
          const applied = await applyCheckpointChoices({...retry, storage: writable});
          const local = JSON.parse(localStorage.getItem(localKey));
          assert(applied.status === 'journey-recovery-applied-locally' && !applied.localReviewRequired, 'cutover not confirmed');
          assert(local.learning === false && local.journeys[0].count === 7 && local.journeys[0].savedRoutes[0].route === '75', 'local history/preference lost');
          assert(local.journeySync.version.generation === 1 && local.journeySync.pending.length === 0, 'journal not cut over');
          assert((await applyCheckpointChoices({...retry, storage: writable})).status === applied.status, 'cutover retry failed');
          assert((await f.store.read(newScope, f.setup.group)).revision === after.revision, 'cutover duplicated shared write');
          const {writePreferencesLocked} = await import('./journey-sync/app-preferences.mjs');
          assert(!await writePreferencesLocked(JSON.parse(raw), {expectedRaw: raw, storage: writable}), 'stale writer overwrote recovery');
          assert(localStorage.getItem(localKey) === JSON.stringify(local), 'stale writer changed local data');
        }
      }
      f.store.close();
    }
    return {group: first.setup.group, member: first.setup.member, pending, installationGroup, choiceRetry};
  });
  await page.reload();
  const reopened = await page.evaluate(async ({group, pending}) => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const store = await (await import('./tg-pairing/storage.mjs')).openBrowserStorage('journey-migration');
    try {
      const before = await store.read('along-saved-journeys-v2', group);
      const answer = await (await import('./journey-sync/generation-migration.mjs')).migrateJourneyGeneration({wasm, store,
        expectedGroup: Uint8Array.from(group.match(/../g), n => parseInt(n, 16)), expectedRevision: 1});
      return answer.alreadyMigrated && (await store.read('along-saved-journeys-v2', group)).revision === before.revision
        && localStorage.getItem('along-journeys-v1') === pending;
    } finally { store.close(); }
  }, result);
  assert.equal(reopened, true);
  const installationRestored = await page.evaluate(async group => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const store = await (await import('./tg-pairing/storage.mjs')).openBrowserStorage('checkpoint-install-valid');
    try {
      const saved = await store.read('along-journey-checkpoint-recovery-v1', group + ':1');
      const result = await (await import('./journey-sync/checkpoint-installation.mjs')).installJourneyCheckpoint({wasm, store,
        expectedGroup: Uint8Array.from(group.match(/../g), n => parseInt(n, 16)), expectedRevision: saved.value.sourceRevision,
        expectedLocalRaw: saved.value.localRaw, checkpoint: saved.value.checkpoint, snapshot: saved.value.snapshot,
        storage: {getItem: () => localStorage.getItem('install-valid'), setItem: () => { throw Error('unexpected write'); }}});
      return result.alreadyInstalled && result.localReviewRequired;
    } finally { store.close(); }
  }, result.installationGroup);
  assert.equal(installationRestored, true);
  assert.equal(await page.evaluate(async ({group, reviewId, choices}) => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const store = await (await import('./tg-pairing/storage.mjs')).openBrowserStorage('checkpoint-choice-valid');
    try {
      const result = await (await import('./journey-sync/checkpoint-choice-commit.mjs')).commitCheckpointChoices({wasm, store,
        expectedGroup: Uint8Array.from(group.match(/../g), n => parseInt(n, 16)), generation: 1, reviewId, choices,
        storage: {getItem: () => localStorage.getItem('choice-valid'), setItem: () => { throw Error('unexpected local write'); }}});
      return result.alreadyCommitted && result.localReviewRequired;
    } finally { store.close(); }
  }, result.choiceRetry), true);
  console.log('PASS: actual recovery choices commit once and survive reload; stale review, changed choices, permission race and interrupted transaction refuse; final cutover retains history, handles local write failure, refuses newer local data and retries without duplicate replica edits. App integration remains pending.');
  const peerTab = await page.context().newPage();
  await peerTab.goto(`http://127.0.0.1:${server.address().port}/`);
  const rawForTabs = await page.evaluate(() => localStorage.getItem('choice-valid'));
  const tabWrites = await Promise.all([page, peerTab].map((tab, i) => tab.evaluate(async ({raw, route}) => {
    const {writePreferencesLocked} = await import('./journey-sync/app-preferences.mjs');
    const data = JSON.parse(raw); data.journeys[0].savedRoutes = [{mode: 'bus', route}];
    return writePreferencesLocked(data, {expectedRaw: raw, storage: {
      getItem: () => localStorage.getItem('choice-valid'), setItem: (_, value) => localStorage.setItem('choice-valid', value),
    }});
  }, {raw: rawForTabs, route: String(80 + i)})));
  assert.equal(tabWrites.filter(Boolean).length, 1);
  const tabResult = await page.evaluate(() => JSON.parse(localStorage.getItem('choice-valid')));
  assert.equal(tabResult.journeySync.pending.length, 1);
  assert.equal(tabResult.journeySync.pending[0].version.generation, 1);
  assert.equal(tabResult.journeys[0].count, 7);
  await peerTab.close();
  console.log('PASS: two real tabs using the locked writer cannot overwrite each other from the same stale input; exactly one new-generation operation remains and history is preserved. Legacy synchronous callers are not covered by this guarantee.');
  const bridgeResult = await page.evaluate(async ({group, member}) => {
    const {openGenerationAppJourneyStore} = await import('./journey-sync/generation-app-store.mjs');
    const {readEnvelope, readPreferences, writePreferences} = await import('./journey-sync/app-preferences.mjs');
    const store = await (await import('./tg-pairing/storage.mjs')).openBrowserStorage('journey-migration');
    try {
      const bridge = openGenerationAppJourneyStore({store, group, actor: member});
      const archive = await store.read('along-journey-migration-v1', group), damaged = structuredClone(archive.value);
      damaged.importReceipt.value.operation = 'damaged';
      const rawBefore = readEnvelope().raw;
      await store.compareAndSwap('along-journey-migration-v1', group, archive.revision, damaged);
      if (await bridge.reconcile().then(() => true, () => false)) throw Error('corrupt archived receipt accepted');
      if (readEnvelope().raw !== rawBefore) throw Error('corrupt receipt consumed pending edit');
      await store.compareAndSwap('along-journey-migration-v1', group, archive.revision + 1, archive.value);
      const migrated = await bridge.reconcile();
      if (migrated.clock !== 3 || migrated.journeys.some(j => j.value !== null)) throw Error('migration replay duplicated old receipt or lost deletion');
      if (readEnvelope().sync.pending.length !== 0 || readPreferences().journeys[0].count !== 7) throw Error('pending/history mismatch');
      // Deliberately fail the local journal write after its real IDB commit.
      const data = readPreferences(); data.journeys[0].saved = true;
      if (!writePreferences(data)) throw Error('resave failed');
      const fault = openGenerationAppJourneyStore({store, group, actor: member,
        storage: {getItem: key => localStorage.getItem(key), setItem: () => { throw Error('storage full'); }}});
      if (await fault.reconcile().then(() => true, () => false)) throw Error('expected journal failure');
      const committed = await store.read('along-saved-journeys-v2', group);
      if (committed.value.clock !== 4 || readEnvelope().sync.pending.length !== 1) throw Error('failed journal write lost edit');
      await bridge.reconcile();
      if ((await store.read('along-saved-journeys-v2', group)).value.clock !== 4) throw Error('duplicate format-2 import');
      const nextEdit = readPreferences(); nextEdit.journeys[0].saved = false; writePreferences(nextEdit);
      const retained = readEnvelope().raw;
      const before = await store.read('along-saved-journeys-v2', group);
      // Boundary fixture only: a future installer will authenticate this advance.
      await store.compareAndSwap('along-saved-journeys-v2', group, before.revision,
        {...before.value, generation: 1, checkpoint: 'a'.repeat(64)});
      if (await bridge.reconcile().then(() => true, () => false)) throw Error('old journal entered new generation');
      if (readEnvelope().raw !== retained) throw Error('mismatched generation consumed local edits');
      const marked = readEnvelope().data; marked.journeySync.version = {generation: 1, checkpoint: 'a'.repeat(64)};
      localStorage.setItem('along-journeys-v1', JSON.stringify(marked));
      if (await bridge.reconcile().then(() => true, () => false)) throw Error('queue marker retagged an old operation');
      delete marked.journeySync.pending[0].version;
      localStorage.setItem('along-journeys-v1', JSON.stringify(marked));
      if (await bridge.reconcile().then(() => true, () => false)) throw Error('unmarked older-app edit entered new generation');
      return {clock: migrated.clock, finalClock: (await store.read('along-saved-journeys-v2', group)).value.clock,
        pending: readEnvelope().sync.pending.length, count: readPreferences().journeys[0].count};
    } finally { store.close(); }
  }, result);
  assert.deepEqual(bridgeResult, {clock: 3, finalClock: 4, pending: 1, count: 7});
  console.log('PASS: actual software identity and IndexedDB migration preserve replica/tombstones/import receipt/local pending edits; concurrent/reloaded retries do not rewrite; stale review, permission race, cancellation and interrupted transaction preserve old state; old in-flight format-1 writer cannot overwrite migration. No app migration UI enabled.');
  console.log('PASS: format-2 bridge consumes an archived receipt without duplicating its edit, imports queued deletion, retains history, recovers an IDB/localStorage interruption and refuses old queued edits after a fixture generation advance. The separate real installation cases follow.');
  console.log('PASS: real issuer checkpoint installation atomically retains prior replica/local journal and starts a new receipt; retry/reload, permission races, interrupted writes, stale review, changed local data, signature damage, late cancellation and concurrent local edits preserve the documented boundary. Local review and peer delivery remain unfinished.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
