import {journeyAlertContexts} from '../../public/live-time.js';
import {showContextLiveUpdates} from './stop-live-view.mjs';

// Caller remounts when advancing a leg. Snapshot the chosen itinerary and never
// rerank it, replace its scheduled times, or request updates for completed legs.
export function showJourneyLiveUpdates(container, {client, journey, date, currentLeg = 0, now}) {
  if (!Array.isArray(journey?.legs) || !Number.isSafeInteger(currentLeg)
      || currentLeg < 0 || currentLeg > journey.legs.length) throw new Error('Journey context unavailable');
  const legs = structuredClone(journey.legs.slice(currentLeg));
  const transit = legs.filter(leg => leg.mode !== 'walk' && leg.trip);
  return showContextLiveUpdates(container, {client, now, date, scope: 'your remaining journey',
    scheduledText: 'Your scheduled itinerary', enabled: transit.length > 0,
    contexts: journeyAlertContexts(transit, date),
    rows: transit.map(leg => ({...leg, stop: leg.from, description: `${leg.route} from ${leg.from.name}`}))});
}
