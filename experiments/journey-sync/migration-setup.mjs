// Explicit reviewed local setup, not peer recovery or a capacity reset.
import {migrateJourneyGeneration} from './generation-migration.mjs';
import {isolatePlannerPreferences} from './isolated-preferences.mjs';
import {readJourneyStartupState} from './startup-state.mjs';
export async function setupJourneyGeneration({wasm, store, expectedGroup, expectedRevision, expectedRaw,
  storage = globalThis.localStorage, locks = globalThis.navigator?.locks, signal}) {
  if (!(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32) throw Error('Journey setup unavailable');
  const group = expectedGroup.slice(), id = Array.from(group,b=>b.toString(16).padStart(2,'0')).join('');
  const checked = async () => {
    const state = await readJourneyStartupState({wasm,store,expectedGroup:group,storage,signal});
    if (!['isolation-required','generation-ready'].includes(state.status) || state.generation !== 0)
      throw Error('Journey setup could not be confirmed; retained migration may already exist');
    return state;
  };
  const isolated = await isolatePlannerPreferences({group:id,expectedRaw,storage,locks,signal,prepare:async()=>{
    await migrateJourneyGeneration({wasm,store,expectedGroup:group,expectedRevision,signal});
    await checked();
  }});
  const state = await checked();
  if (state.status !== 'generation-ready') throw Error('Journey storage isolation not confirmed');
  return {status:'journey-generation-setup-locally',generation:0,legacyChangesPending:isolated.legacyChangesPending,
    capacityRecovered:false,peerSharingAvailable:false};
}
