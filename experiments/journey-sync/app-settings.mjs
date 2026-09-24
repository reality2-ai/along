import {showJourneyConnection} from './connection-view.mjs';
import {showJourneyDevices} from './devices-view.mjs';
import {openAppJourneyStore} from './app-store.mjs';
import {openGenerationAppJourneyStore} from './generation-app-store.mjs';
import {readJourneyStartupState} from './startup-state.mjs';
import {createCheckpointReview} from './checkpoint-review.mjs';
import {showCheckpointReview} from './checkpoint-review-view.mjs';
import {applyCheckpointChoices} from './checkpoint-choice-commit.mjs';
import {setupJourneyGeneration} from './migration-setup.mjs';
import {loadSoftwareIssuer} from '../tg-pairing/software-persona.mjs';
import {checkpointSnapshot} from './generation-state.mjs';
import {verifyJourneyCheckpoint} from './generation-checkpoint.mjs';
import {installJourneyCheckpoint} from './checkpoint-installation.mjs';
import {enableJourneyTracking, readEnvelope, changedEvent, preferenceKey} from './app-preferences.mjs';
import {JourneyCapacityError} from './state.mjs';

export function mountAppJourneySettings({wasm, store, expectedGroup, member}) {
  const group = Array.from(expectedGroup, b => b.toString(16).padStart(2, '0')).join('');
  const replica = openAppJourneyStore({store, group, actor: member});
  const settings = document.querySelector('#settings');
  const node = (tag, text) => { const n = document.createElement(tag); n.textContent = text; return n; };
  const open = node('button', 'Share saved journeys with my devices'); open.type = 'button'; open.className = 'secondary-button';
  settings.insertBefore(open, settings.querySelector('#alerts-open'));
  const dialog = node('dialog', ''); dialog.setAttribute('aria-label', 'Saved journey sharing');
  const content = node('section', ''); content.className = 'pairing-comparison'; dialog.append(content); document.body.append(dialog);
  const lifetime = new AbortController();
  let startup = {status: 'checking'};
  let reviewDraft;
  let capacityReached = false;
  const startupMessage = () => ({
    checking: 'Checking this device’s saved journeys…',
    'isolation-required': 'Saved-journey migration needs to finish on this device. Your existing copies are kept; sharing is paused.',
    'local-review-required': 'Review the retained saved-place differences before sharing again. Your existing copies are kept.',
    'generation-ready': (startup.generation === 0 ? 'Saved-journey storage is prepared on this device. ' : 'This device has recovered saved journeys. ') + 'Connections for this storage version are not enabled yet. You can still plan and save here.',
    unavailable: 'Saved-journey recovery could not be checked. Your stored copies have not been cleared. Sharing is paused.',
  })[startup.status];
  const checkStartup = async () => {
    startup = await readJourneyStartupState({wasm, store, expectedGroup, signal: lifetime.signal});
    if (startup.status !== 'legacy') { disconnect(); report(startupMessage()); }
    return startup.status;
  };
  let view, session, disposed = false, status, queue = Promise.resolve(), message = '', generation = 0, starting = false, screen = 'home';
  const clear = () => { generation++; starting = false; view?.dispose(); view = undefined; content.replaceChildren(); };
  const report = text => { message = text; if (status?.isConnected) status.textContent = text; };
  const reportFailure = error => {
    capacityReached ||= error instanceof JourneyCapacityError;
    report(error instanceof JourneyCapacityError
    ? 'Sharing has reached its 256-place limit, including deleted places. Your saved places and queued changes remain here. You can continue planning on this device. Reconnecting or deleting places will not free sharing space.'
    : 'Sharing is unavailable. Your saved places and pending changes remain on this device. Try connecting again.');
    if (capacityReached && dialog.open && screen === 'home') home();
  };
  const reconcile = (send = false) => {
    queue = queue.then(async () => {
      if (disposed) return;
      const state = await checkStartup();
      if (disposed) return;
      if (state === 'generation-ready') {
        await openGenerationAppJourneyStore({store, group, actor: member}).reconcile({signal: lifetime.signal});
        return;
      }
      if (state !== 'legacy') return;
      if (readEnvelope().sync?.group !== group) return;
      await replica.reconcile({signal: lifetime.signal});
      if (disposed) return;
      if (send && session) {
        await session.synchronize();
        report('Your other device confirmed saving this snapshot. Later changes will be sent while both devices stay connected.');
      }
    }).catch(error => { if (!disposed) reportFailure(error); });
    return queue;
  };
  const localChange = event => { if (event.type !== 'storage' || event.key === preferenceKey
    || event.key === preferenceKey + ':generation-profile-v1' || event.key === null) void reconcile(true); };
  window.addEventListener(changedEvent, localChange); window.addEventListener('storage', localChange);
  const disconnect = () => {
    const previous = session; session = undefined;
    previous?.signal.removeEventListener('abort', disconnected); previous?.close();
  };
  const disconnected = () => { session = undefined; message = 'Connection ended. Saved changes stay on this device until you reconnect.'; if (dialog.open && screen === 'home') home(); };
  const back = () => { clear(); dialog.close(); settings.showModal(); open.focus(); };
  const action = (text, run) => {
    const button = node('button', text); button.type = 'button';
    const selected = generation;
    button.addEventListener('click', event => { if (event.isTrusted && !disposed && selected === generation && !button.disabled) void run(); }); content.append(button); return button;
  };
  const connect = async role => {
    if (starting) return; starting = true;
    const selected = generation;
    try {
      if (await checkStartup() !== 'legacy') { if (!disposed && dialog.open && generation === selected) home(); return; }
      enableJourneyTracking(group); await replica.reconcile({signal: lifetime.signal});
      if (disposed || !dialog.open || generation !== selected) return;
      clear();
      screen = 'connection';
      view = showJourneyConnection(content, {wasm, store, expectedGroup, role, focus: true, signal: lifetime.signal, onBack: home,
        onSaved: () => { void reconcile(); },
        onConnected: connected => {
          if (disposed) { connected.close(); return; }
          disconnect(); session = connected;
          session.signal.addEventListener('abort', disconnected, {once: true});
          if (session.signal.aborted) { disconnected(); return; }
          message = 'Connected. Sharing saved places and service preferences…'; home(); void reconcile(true);
        }});
    } catch (error) { if (!disposed && generation === selected) reportFailure(error); }
    finally { if (generation === selected) starting = false; }
  };
  const reviewLocalDifferences = async () => {
    if (starting) return; starting = true;
    const selected = generation;
    try {
      if (await checkStartup() !== 'local-review-required') {
        if (!disposed && dialog.open && generation === selected) home(); return;
      }
      const reviewGeneration = startup.generation;
      const replica = await store.read('along-saved-journeys-v2', group);
      const recovery = await store.read('along-journey-checkpoint-recovery-v1', group + ':' + reviewGeneration);
      const review = await createCheckpointReview({current: replica?.value, recovery: recovery?.value,
        localRaw: readEnvelope().raw, actor: member});
      if (disposed || !dialog.open || generation !== selected) return;
      clear(); screen = 'local-review';
      view = showCheckpointReview(content, {review, focus: true, signal: lifetime.signal,
        initialChoices: reviewDraft?.reviewId === review.id ? reviewDraft.choices : [],
        onConfirm: async ({reviewId, choices, signal}) => {
          const result = await applyCheckpointChoices({wasm, store, expectedGroup, generation: reviewGeneration,
            reviewId, choices, signal});
          reviewDraft = undefined;
          await checkStartup();
          return result;
        },
        onBack: async retained => {
          reviewDraft = retained;
          const active = generation;
          await checkStartup();
          if (!disposed && dialog.open && generation === active) home();
        },
      });
    } catch (error) { if (!disposed && dialog.open && generation === selected) reportFailure(error); }
    finally { if (generation === selected) starting = false; }
  };
  const reviewMigrationSetup = async () => {
    if (starting) return; starting = true;
    const selected = generation;
    try {
      const state = await checkStartup();
      if (state !== 'legacy' && !(state === 'isolation-required' && startup.generation === 0)) throw Error('Setup state changed');
      const archive = await store.read('along-journey-migration-v1', group);
      const old = await store.read('along-saved-journeys-v1', group);
      const expectedRevision = archive?.value.sourceRevision ?? old?.revision ?? 0;
      const expectedRaw = localStorage.getItem(preferenceKey);
      if (disposed || !dialog.open || generation !== selected) return;
      clear(); screen = 'migration-setup';
      const heading = node('h2', 'Prepare saved-journey recovery?'); heading.tabIndex = -1;
      content.append(heading,node('p','Keep your current saved places and queued edits in separate storage so older app copies cannot overwrite recovered data. The original copy is retained.'),
        node('p','This prepares this device only. It does not free sharing space yet. Connections for the new storage version are not enabled; you can still plan and save offline.'));
      const note = node('p',''); note.setAttribute('role','status'); content.append(note);
      const controller = new AbortController(); view = {dispose:()=>controller.abort()};
      const confirm = action('Prepare recovery on this device',async()=>{
        disconnect();
        confirm.disabled=true; note.textContent='Preparing your saved journeys…';
        try {
          await setupJourneyGeneration({wasm,store,expectedGroup,expectedRevision,expectedRaw,signal:controller.signal});
          if (controller.signal.aborted || disposed) return;
          await checkStartup();
          if (controller.signal.aborted || disposed) return;
          capacityReached=false; home();
        } catch {
          if (!controller.signal.aborted && !disposed) note.textContent='Setup could not be confirmed. Your retained copies are kept. Go Back and check recovery status before trying again.';
        }
      }); confirm.className='pairing-primary';
      action('Back',()=>{controller.abort();home();}); heading.focus();
    } catch(error) {if(!disposed&&generation===selected)reportFailure(error);}
    finally {if(generation===selected)starting=false;}
  };
  const reviewCheckpoint = async () => {
    if (starting) return; starting=true;
    const selected=generation;
    try {
      if (await checkStartup() !== 'generation-ready' || !startup.canPrepareCheckpoint) throw Error('Issuer unavailable');
      const replica=await store.read('along-saved-journeys-v2',group);
      const retained=await store.read('along-prepared-journey-checkpoint-v1',group+':'+(replica.value.generation+1));
      let snapshot=checkpointSnapshot(replica.value);
      if(retained){
        await verifyJourneyCheckpoint({bytes:retained.value.checkpoint,current:replica.value,snapshot:retained.value.snapshot});
        snapshot=structuredClone(retained.value.snapshot);
      }
      const expectedRaw=readEnvelope().raw;
      if(disposed||!dialog.open||generation!==selected)return;
      clear();screen='checkpoint-review';
      const heading=node('h2','Start a new sharing checkpoint?');heading.tabIndex=-1;
      content.append(heading,node('p',`${snapshot.journeys.length} shared saved place${snapshot.journeys.length===1?'':'s'} will form the new checkpoint. Old deletion records leave the active shared list; a recovery copy is retained.`),
        node('p','Your local saved places and queued edits stay here for the next review. This confirms this device only; other devices have not received the checkpoint.'));
      if(retained)content.append(node('p','This checkpoint was prepared earlier. Changes made since then will be included in the next review.'));
      const details=node('details',''),summary=node('summary','See saved places in this checkpoint'),list=node('ul','');
      for(const entry of snapshot.journeys)list.append(node('li',entry.value.from.name+' → '+entry.value.to.name+
        (entry.value.savedRoutes?.length?' · '+entry.value.savedRoutes.map(route=>route.mode+' '+route.route).join(' → '):'')));
      details.append(summary,list);content.append(details);
      const note=node('p','');note.setAttribute('role','status');content.append(note);
      const controller=new AbortController();let issuer;
      view={dispose:()=>{controller.abort();issuer?.close();}};
      const confirm=action('Create checkpoint and review my places',async()=>{
        confirm.disabled=true;note.textContent='Checking and saving this checkpoint…';disconnect();
        try{
          issuer=await loadSoftwareIssuer({wasm,store,expectedGroup,signal:controller.signal});
          const prepared=await issuer.prepareJourneyCheckpoint({expectedRevision:replica.revision});
          if(JSON.stringify(prepared.snapshot)!==JSON.stringify(snapshot))throw Error('Checkpoint changed');
          await installJourneyCheckpoint({wasm,store,expectedGroup,expectedRevision:replica.revision,expectedLocalRaw:expectedRaw,
            checkpoint:prepared.checkpoint,snapshot:prepared.snapshot,signal:controller.signal});
          issuer.close();issuer=undefined;
          await checkStartup();
          if(controller.signal.aborted||disposed)return;
          capacityReached=false;home();await reviewLocalDifferences();
        }catch{
          issuer?.close();issuer=undefined;
          if(!controller.signal.aborted&&!disposed)note.textContent='The checkpoint could not be confirmed. Your retained copies are kept. Go Back and check recovery status before trying again.';
        }
      });confirm.className='pairing-primary';
      action('Back',()=>{controller.abort();issuer?.close();home();});heading.focus();
    }catch(error){if(!disposed&&generation===selected)reportFailure(error);}
    finally{if(generation===selected)starting=false;}
  };
  const home = () => {
    clear(); screen = 'home';
    const heading = node('h2', session ? 'Your journeys are connected' : 'Share your saved journeys'); heading.tabIndex = -1;
    content.append(heading, node('p', 'Share saved starting places, destinations and service preferences with an enrolled device. Learning history, current location and the journey on screen stay here. This does not require an AT key.'));
    status = node('p', message || 'Both devices must be online and open. Connection currently uses messages you transfer between them.'); status.setAttribute('role', 'status'); content.append(status);
    if (startup.status !== 'legacy') {
      status.textContent = startupMessage();
      if (startup.legacyChangesPending) content.append(node('p', 'An older app copy has additional edits. They remain separate and still need review.'));
      if (startup.status === 'isolation-required' && startup.generation === 0) action('Finish saved-journey setup',reviewMigrationSetup).className='pairing-primary';
      if (startup.status === 'local-review-required') action('Review saved-place differences', reviewLocalDifferences).className = 'pairing-primary';
      const canCheckpoint=startup.status==='generation-ready'&&startup.canPrepareCheckpoint&&(startup.generation===0||capacityReached);
      if(canCheckpoint)action('Review recovery checkpoint',reviewCheckpoint).className='pairing-primary';
      action('Check saved-journey recovery', async () => {
        const selected = generation; await checkStartup();
        if (!disposed && dialog.open && generation === selected) home();
      }).className = canCheckpoint || startup.status === 'local-review-required' || (startup.status === 'isolation-required' && startup.generation === 0) ? '' : 'pairing-primary';
    } else if (session) {
      action('Check for saved journey changes', () => reconcile(true)).className = 'pairing-primary';
      action('Disconnect journey sharing', () => { disconnect(); message = 'Disconnected. Saved changes stay here until you reconnect.'; home(); });
    } else {
      action('Start journey connection', () => connect('start')).className = 'pairing-primary';
      action('Join journey connection', () => connect('join'));
    }
    if (startup.status === 'legacy' && capacityReached) action('Review sharing recovery',reviewMigrationSetup);
    action('Manage journey-sharing devices', () => {
      clear(); screen = 'devices';
      view = showJourneyDevices(content, {wasm, store, expectedGroup, focus: true, onBack: home,
        onRemoved: peer => {
          if (session?.peer === peer) disconnect();
          message = 'Journey-sharing permission removed here. Your saved places and copies already shared are kept.';
        }});
    });
    action('Back to settings', back); heading.focus();
  };
  open.addEventListener('click', event => { if (event.isTrusted && !disposed) {
    settings.close(); dialog.showModal(); startup={status:'checking'}; home(); const selected = generation;
    void checkStartup().then(() => { if (!disposed && dialog.open && generation === selected) home(); });
  } });
  dialog.addEventListener('cancel', event => { event.preventDefault(); back(); });
  dialog.addEventListener('close', clear);
  void reconcile();
  return Object.freeze({dispose() {
    if (disposed) return; disposed = true; lifetime.abort(); clear(); disconnect();
    window.removeEventListener(changedEvent, localChange); window.removeEventListener('storage', localChange); open.remove(); dialog.remove();
  }});
}
