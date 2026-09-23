// Application data only. Transport must authenticate group membership separately.
// No clock time, search history, credentials or current-screen state is included.
const idPattern = /^[0-9a-f]{64}$/;
const limit = 256;
const fail = () => { throw new Error('Saved-journey state unavailable'); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const clock = value => Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const point = value => {
  if (!exact(value, ['id', 'name', 'lat', 'lon', 'placeType'])
      || !(text(value.id, 160) || Number.isSafeInteger(value.id)) || !text(value.name, 512)
      || !Number.isFinite(value.lat) || Math.abs(value.lat) > 90
      || !Number.isFinite(value.lon) || Math.abs(value.lon) > 180
      || !['address', 'stop'].includes(value.placeType)) fail();
  return {id: value.id, name: value.name, lat: value.lat, lon: value.lon, placeType: value.placeType};
};
export function journeyValue(value) {
  if (!exact(value, ['from', 'to', 'savedRoutes'])) fail();
  const from = point(value.from), to = point(value.to);
  if (value.savedRoutes !== null && (!Array.isArray(value.savedRoutes) || value.savedRoutes.length > 4
      || value.savedRoutes.some(route => !exact(route, ['mode', 'route'])
        || !['bus', 'train', 'ferry'].includes(route.mode) || !text(route.route, 120) || !route.route.trim()))) fail();
  return {from, to, savedRoutes: value.savedRoutes?.map(({mode, route}) => ({mode, route})) ?? null};
}
// Explicit projection from the planner's richer records, never a preferences dump.
export function projectJourney({from, to, savedRoutes = null}) {
  const project = place => ({id: place.id, name: place.name, lat: place.lat, lon: place.lon,
    placeType: place.placeType === 'address' ? 'address' : 'stop'});
  return journeyValue({from: project(from), to: project(to), savedRoutes});
}
export function journeyId(value) {
  const journey = journeyValue(value);
  return JSON.stringify([journey.from.placeType, journey.from.id, journey.to.placeType, journey.to.id]);
}
const validJourneyId = id => {
  if (!text(id, 700)) return false;
  try {
    const parts = JSON.parse(id);
    return Array.isArray(parts) && parts.length === 4 && JSON.stringify(parts) === id
      && [parts[0], parts[2]].every(kind => ['address', 'stop'].includes(kind))
      && [parts[1], parts[3]].every(value => text(value, 160) || Number.isSafeInteger(value));
  } catch { return false; }
};
export function emptyState(group) {
  if (!idPattern.test(group)) fail();
  return {format: 1, group, clock: 0, journeys: []};
}
export function validateState(input, group) {
  if (!exact(input, ['format', 'group', 'clock', 'journeys']) || input.format !== 1
      || input.group !== group || !idPattern.test(group) || !clock(input.clock)
      || !Array.isArray(input.journeys) || input.journeys.length > limit) fail();
  const ids = new Set(), stamps = new Set();
  const journeys = input.journeys.map(entry => {
    if (!exact(entry, ['id', 'clock', 'actor', 'value']) || !validJourneyId(entry.id)
        || !clock(entry.clock) || entry.clock < 1 || entry.clock > input.clock
        || !idPattern.test(entry.actor) || ids.has(entry.id)) fail();
    const stamp = entry.actor + ':' + entry.clock;
    if (stamps.has(stamp)) fail();
    ids.add(entry.id); stamps.add(stamp);
    const value = entry.value === null ? null : journeyValue(entry.value);
    if (value && journeyId(value) !== entry.id) fail();
    return {id: entry.id, clock: entry.clock, actor: entry.actor, value};
  });
  journeys.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {format: 1, group, clock: input.clock, journeys};
}
const compare = (a, b) => a.clock - b.clock || (a.actor < b.actor ? -1 : a.actor > b.actor ? 1 : 0);
export function mergeStates(left, right) {
  const a = validateState(left, left.group), b = validateState(right, a.group);
  const entries = new Map(), stamps = new Map();
  for (const entry of [...a.journeys, ...b.journeys]) {
    const stamp = entry.actor + ':' + entry.clock, previous = stamps.get(stamp);
    if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) fail();
    stamps.set(stamp, entry);
    const held = entries.get(entry.id);
    if (!held || compare(entry, held) > 0) entries.set(entry.id, entry);
  }
  return validateState({format: 1, group: a.group, clock: Math.max(a.clock, b.clock), journeys: [...entries.values()]}, a.group);
}
export function changeJourney(state, actor, id, value) {
  const saved = validateState(state, state.group);
  if (!idPattern.test(actor) || !validJourneyId(id) || !clock(saved.clock + 1)) fail();
  const next = {id, actor, clock: saved.clock + 1, value: value === null ? null : journeyValue(value)};
  return validateState({...saved, clock: next.clock, journeys: [...saved.journeys.filter(entry => entry.id !== id), next]}, saved.group);
}
export function savedJourneys(state) {
  return validateState(state, state.group).journeys.filter(entry => entry.value !== null).map(entry => entry.value);
}
