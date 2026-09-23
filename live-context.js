// Pure matching: no requests, storage, journey mutation or automatic reranking.
// Callers supply verified GTFS identities for each individual stop/leg context.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const present = value => value !== undefined && value !== null;
const integer = value => (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) && Number.isSafeInteger(Number(value)) && Number(value) >= 0;
const same = (a,b) => typeof a === 'string' && a.length > 0 && a === b;
const numericSame = (a,b) => integer(a) && integer(b) && Number(a) === Number(b);

function fieldsMatch(selector, context, allowed) {
  return Object.entries(selector).every(([key,value]) => {
    // Unknown restrictions cannot be silently discarded to broaden scope.
    if (!allowed.includes(key)) return false;
    if (!present(value)) return false;
    return ['route_type','direction_id'].includes(key)
      ? numericSame(value,context[key]) : same(value,context[key]);
  });
}

export function matchesSelector(selector, context) {
  if (!object(selector) || !object(context) || !Object.keys(selector).length) return false;
  const {trip,...fields} = selector;
  if (!fieldsMatch(fields,context,['agency_id','route_id','route_type','direction_id','stop_id'])) return false;
  if (present(fields.direction_id) && !fields.route_id) return false;
  if (Object.hasOwn(selector,'trip')) {
    if (!object(trip) || !object(context.trip)) return false;
    // A verified dated trip context is required, even for an all-days alert.
    if (!/^\d{8}$/.test(context.trip.start_date || '') || !context.trip.trip_id) return false;
    const {schedule_relationship,...identity} = trip;
    if (!Object.keys(identity).length || !fieldsMatch(identity,context.trip,
      ['trip_id','route_id','direction_id','start_date','start_time'])) return false;
  }
  return true;
}

// GTFS time ranges are half-open; omitted bounds mean infinity.
function overlaps(periods, start, end) {
  if (periods === undefined) return true;
  if (!Array.isArray(periods)) return false;
  if (!periods.length) return true;
  return periods.some(period => {
    if (!object(period) || Object.keys(period).some(k=>!['start','end'].includes(k))) return false;
    if ((Object.hasOwn(period,'start') && !integer(period.start)) ||
        (Object.hasOwn(period,'end') && !integer(period.end))) return false;
    const lo=present(period.start)?Number(period.start):-Infinity;
    const hi=present(period.end)?Number(period.end):Infinity;
    return lo < hi && (start===end ? lo<=start && start<hi : lo<end && start<hi);
  });
}

export function contextualAlerts(feed, contexts, {now=Date.now()/1000, maxAge=180}={}) {
  if (!feed?.available || !integer(feed.updated) || !Number.isFinite(now) ||
      !Number.isFinite(maxAge) || maxAge<0 || Math.abs(now-Number(feed.updated))>maxAge ||
      !Array.isArray(feed.alerts) || !Array.isArray(contexts)) return [];
  return feed.alerts.filter(alert => {
    if (!object(alert) || !Array.isArray(alert.informed_entity) || !alert.informed_entity.length) return false;
    // Communication controls when an alert can be shown; impact controls when
    // travel is affected. Legacy feeds provide active_period instead.
    if (!overlaps(Object.hasOwn(alert,'communication_period') ? alert.communication_period : alert.active_period,now,now)) return false;
    return contexts.some(context => object(context) && Number.isFinite(context.start) &&
      Number.isFinite(context.end) && context.start<=context.end &&
      overlaps(Object.hasOwn(alert,'impact_period') ? alert.impact_period : alert.active_period,context.start,context.end) &&
      alert.informed_entity.some(selector=>matchesSelector(selector,context)));
  });
}
