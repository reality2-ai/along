// Real enrollment fixture supplies identities. Connection/consent use visible
// controls; the harness copies public messages, not app Settings integration.
import {openJourneySession} from './journey-session.mjs';
import {showJourneyConnection} from './connection-view.mjs';
import {showJourneyPermission} from './permission-view.mjs';
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
  const permissionBefore = JSON.stringify(await receiver.store.read('along-journey-sharing-v1', hex(group)));
  const descriptor = {profile: 'along-journey-connect-v2', group: hex(group), member: hex(owner.subject), certificate: [...owner.certificate], removals: ''};
  for (const [message, cancel] of [
    [{...descriptor, group: '00'.repeat(32)}, false],
    [{...descriptor, member: hex(receiver.subject)}, false],
    [descriptor, true],
  ]) {
    const container = document.createElement('div'); container.id = 'journey-negative'; document.querySelector('main').append(container);
    let left = false, connected = false;
    const view = showJourneyConnection(container, {...options[1], role: 'join', focus: true,
      onBack: () => { left = true; }, onConnected: session => { connected = true; session.close(); }});
    try {
      await view.ready; await window.exerciseJourneyConnectionRejected(JSON.stringify(message), cancel);
      check(!connected && left === cancel, 'wrong message or Back never hands off a session');
      check(JSON.stringify(await receiver.store.read('along-journey-sharing-v1', hex(group))) === permissionBefore, 'wrong message or Back preserves permission');
    } finally { view.dispose(); container.remove(); }
  }
  const a = openJourneyStore({store: owner.store, group: hex(group), actor: hex(owner.subject)});
  const b = openJourneyStore({store: receiver.store, group: hex(group), actor: hex(receiver.subject)});
  const value = number => projectJourney({from: {id: 'sync-from', name: 'Tāmaki Makaurau', lat: -36, lon: 174},
    to: {id: 'sync-' + number, name: 'Saved destination ' + number, lat: -37, lon: 175}, savedRoutes: [{mode: 'bus', route: '70'}]});
  for (let n = 0; n < 12; n++) await a.save(value(n));
  await b.save(value(20));
  let sessions;
  const connect = async () => {
    sessions = [];
    const containers = ['journey-start', 'journey-join'].map(id => {
      const node = document.createElement('div'); node.id = id; document.querySelector('main').append(node); return node;
    });
    const views = options.map((context, index) => showJourneyConnection(containers[index], {...context,
      role: index ? 'join' : 'start', focus: true, onConnected: session => { sessions[index] = session; }}));
    try {
      await Promise.all(views.map(view => view.ready));
      await window.exerciseJourneyConnection();
      check(sessions.length === 2 && sessions.every(Boolean), 'visible connection hands off both authenticated controllers');
    } finally { views.forEach(view => view.dispose()); containers.forEach(node => node.remove()); }
    await Promise.all(sessions.map(session => session.authenticated())); // handoff survives view disposal
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
    const removal = showJourneyPermission(document.querySelector('#consent'), {...options[0], focus: true});
    await removal.ready; await window.exerciseJourneyPermission('remove'); await removal.completed; removal.dispose();
    const before = JSON.stringify(await a.read());
    await b.save(value('denied'));
    check(await denied(() => sessions[1].synchronize()), 'removed permission refuses an existing authenticated channel');
    check(JSON.stringify(await a.read()) === before, 'denied peer save changes no local journey');
    check(await owner.store.read('along-at-owners', hex(group)) === null, 'journey exchange needs no AT key');
  } finally { sessions?.forEach(session => session.close()); }
}
