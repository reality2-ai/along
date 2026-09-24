// Shared validation without choosing a planner storage namespace.
export const preferenceKey = 'along-journeys-v1';
const hex = /^[0-9a-f]{64}$/;
export function readEnvelope(storage = globalThis.localStorage) {
  const raw = storage.getItem(preferenceKey);
  const data = raw === null ? {learning: true, journeys: []} : JSON.parse(raw);
  if (!data || !Array.isArray(data.journeys)) throw Error('Saved places unavailable');
  const sync = data.journeySync;
  if (sync !== undefined && (sync?.format !== 1 || !hex.test(sync.group) || !Array.isArray(sync.pending)
      || sync.pending.length > 256)) throw Error('Saved sharing journal unavailable');
  if (sync?.version !== undefined && (!Number.isSafeInteger(sync.version?.generation) || sync.version.generation < 0
      || sync.version.generation >= Number.MAX_SAFE_INTEGER || !hex.test(sync.version.checkpoint)
      || (sync.version.generation === 0) !== (sync.version.checkpoint === '0'.repeat(64)))) throw Error('Saved sharing generation unavailable');
  return {raw, data, sync};
}
