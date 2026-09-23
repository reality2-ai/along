// Invoked by the real enrollment fixture in at-credentials/peer-delivery.test.mjs.
// Consent uses visible controls; fault/stale-state setup uses harness calls.
import {setJourneyPermission, readJourneyPermission, openPermittedJourneys} from './permission.mjs';
import {openJourneyStore} from './store.mjs';
import {projectJourney, savedJourneys} from './state.mjs';
import {showJourneyPermission} from './permission-view.mjs';
export async function checkJourneyPermission({wasm, owner, receiver, group}) {
  const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  const check = (value, message) => { if (!value) throw Error(message); };
  const denied = async action => { try { await action(); return false; } catch { return true; } };
  const options = {wasm, store: owner.store, expectedGroup: group, peer: receiver.subject};
  const reverse = {wasm, store: receiver.store, expectedGroup: group, peer: owner.subject};
  check(await denied(() => openPermittedJourneys(options)), 'enrollment alone does not authorize journey sharing');
  check(await denied(() => setJourneyPermission({...options, certificate: owner.certificate, allow: true, expectedRevision: 0})), 'wrong subject proof cannot grant sharing');
  check((await readJourneyPermission(options)).revision === 0, 'refused grant saves nothing');
  const viewOptions = {...options, certificate: receiver.certificate, focus: true, deviceName: 'Enrolled test phone'};
  let backs = 0;
  const cancelled = showJourneyPermission(document.querySelector('#consent'), {...viewOptions, onBack: () => backs++});
  await cancelled.ready; await window.exerciseJourneyPermission('cancel');
  check(backs === 1 && (await readJourneyPermission(options)).revision === 0, 'Escape leaves permission unchanged');
  const review = showJourneyPermission(document.querySelector('#consent'), viewOptions);
  await review.ready; await window.exerciseJourneyPermission('allow');
  const receipt = await review.completed;
  check(document.activeElement.textContent === 'Back', 'permission confirmation returns focus to Back');
  check(document.querySelector('[role=status]').textContent.includes('has not sent any journeys'), 'permission save does not imply delivery');
  review.dispose();
  check(receipt.revision === 1, 'explicit permission is durable');
  check(await denied(() => openPermittedJourneys(reverse)), 'permission in one direction does not opt in the other device');
  const local = openJourneyStore({store: owner.store, group: hex(group), actor: hex(owner.subject)});
  const remote = openJourneyStore({store: receiver.store, group: hex(group), actor: hex(receiver.subject)});
  const journey = id => projectJourney({from: {id: 'from', name: 'From', lat: -36, lon: 174}, to: {id, name: id, lat: -37, lon: 175}});
  await local.save(journey('local'));
  await remote.save(journey('remote'));
  const permitted = await openPermittedJourneys(options);
  check(savedJourneys(await permitted.snapshot()).length === 1, 'explicitly authorized snapshot');
  await permitted.merge((await remote.read()).state);
  check(savedJourneys((await local.read()).state).length === 2, 'permitted merge preserves independent saves');
  await remote.save(journey('racing-save'));
  let intercepted = false;
  const racing = {...owner.store, compareAndSwapMany: async (changes, args) => {
    if (!intercepted) {
      intercepted = true;
      await setJourneyPermission({...options, allow: false, expectedRevision: 1});
    }
    return owner.store.compareAndSwapMany(changes, args);
  }};
  const pending = await openPermittedJourneys({...options, store: racing});
  check(await denied(async () => pending.merge((await remote.read()).state)), 'permission removed during merge refuses commit');
  check(savedJourneys((await local.read()).state).length === 2, 'denied incoming save leaves local journeys intact');
  check(await denied(() => permitted.snapshot()), 'an existing adapter notices removed permission');
  check(await denied(() => openPermittedJourneys(options)), 'removed permission survives reopening');
  check(await denied(() => setJourneyPermission({...options, certificate: receiver.certificate, allow: true, expectedRevision: 1})), 'stale consent cannot overwrite removal');
  check((await readJourneyPermission(options)).peers.length === 0, 'removal retained');
  const stale = showJourneyPermission(document.querySelector('#consent'), viewOptions);
  await stale.ready;
  await setJourneyPermission({...options, allow: false, expectedRevision: 2});
  await window.exerciseJourneyPermission('allow');
  check(await denied(() => stale.completed), 'stale visible review cannot overwrite a later choice');
  check(document.querySelector('[role=status]').textContent.includes('could not be confirmed'), 'stale review explains how to recover');
  check((await readJourneyPermission(options)).peers.length === 0, 'stale review preserves removal');
  stale.dispose();
  // No application credentials have been configured in either fixture yet.
  check(await owner.store.read('along-at-owners', hex(group)) === null, 'journey permissions do not establish an AT owner');
}
