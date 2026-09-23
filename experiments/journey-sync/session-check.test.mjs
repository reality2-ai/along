// Real enrollment fixture supplies identities. Signaling/consent remain harness actions.
import {openJourneySession} from './journey-session.mjs';
import {setJourneyPermission, readJourneyPermission} from './permission.mjs';
import {openJourneyStore} from './store.mjs';
import {projectJourney, journeyId, savedJourneys} from './state.mjs';
export async function checkJourneySession({wasm, owner, receiver, group}) {
  const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  const check = (value, message) => { if (!value) throw Error(message); };
  const denied = async action => { try { await action(); return false; } catch { return true; } };
  const options = [
    {wasm, store: owner.store, expectedGroup: group, peer: receiver.subject, certificate: receiver.certificate, role: 'offer'},
    {wasm, store: receiver.store, expectedGroup: group, peer: owner.subject, certificate: owner.certificate, role: 'answer'},
  ];
  check(await denied(() => openJourneySession(options[0])), 'session refuses absent permission before signaling');
  for (const context of options) {
    const permission = await readJourneyPermission(context);
    await setJourneyPermission({...context, allow: true, expectedRevision: permission.revision});
  }
  const a = openJourneyStore({store: owner.store, group: hex(group), actor: hex(owner.subject)});
  const b = openJourneyStore({store: receiver.store, group: hex(group), actor: hex(receiver.subject)});
  const value = number => projectJourney({from: {id: 'sync-from', name: 'Tāmaki Makaurau', lat: -36, lon: 174},
    to: {id: 'sync-' + number, name: 'Saved destination ' + number, lat: -37, lon: 175}, savedRoutes: [{mode: 'bus', route: '70'}]});
  for (let n = 0; n < 12; n++) await a.save(value(n));
  await b.save(value(20));
  let sessions;
  const connect = async () => {
    sessions = await Promise.all(options.map(openJourneySession));
    const offer = await sessions[0].offer(), answer = await sessions[1].accept(offer); await sessions[0].accept(answer);
    await Promise.all(sessions.map(session => session.authenticated()));
  };
  const synchronize = async () => {
    for (const session of sessions) check((await session.synchronize()).status === 'peer-saved-snapshot', 'authenticated peer confirms committed snapshot');
    check(JSON.stringify((await a.read()).state) === JSON.stringify((await b.read()).state), 'actual peer snapshots converge');
  };
  try {
    await connect(); await synchronize();
    check(savedJourneys((await b.read()).state).some(journey => journey.to.id === 'sync-11'), 'multi-chunk journey snapshot reaches enrolled receiver');
    sessions.forEach(session => session.close());
    await a.remove(journeyId(value(3))); await b.save(value(21));
    await connect(); await synchronize();
    check(!savedJourneys((await b.read()).state).some(journey => journey.to.id === 'sync-3'), 'offline deletion survives reconnection');
    check(savedJourneys((await a.read()).state).some(journey => journey.to.id === 'sync-21'), 'independent offline save retained');
    const permission = await readJourneyPermission(options[0]);
    await setJourneyPermission({...options[0], allow: false, expectedRevision: permission.revision});
    const before = JSON.stringify(await a.read());
    await b.save(value('denied'));
    check(await denied(() => sessions[1].synchronize()), 'removed permission refuses an existing authenticated channel');
    check(JSON.stringify(await a.read()) === before, 'denied peer save changes no local journey');
    check(await owner.store.read('along-at-owners', hex(group)) === null, 'journey exchange needs no AT key');
  } finally { sessions?.forEach(session => session.close()); }
}
