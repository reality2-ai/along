// Next sharing profile, not yet wired into persistence or the public app.
// Shape validation is NOT authorization to adopt a different generation.
import {validateState, mergeStates, changeJourney} from './state.mjs';
const zero = '0'.repeat(64), hex = /^[0-9a-f]{64}$/;
const fail = () => new Error('Journey generation unavailable');
export class JourneyGenerationMismatch extends Error {
  constructor() { super('Journey sharing requires generation recovery'); this.name = 'JourneyGenerationMismatch'; }
}
const legacy = state => ({format: 1, group: state.group, clock: state.clock, journeys: state.journeys});
const wrap = (state, generation, checkpoint) => ({format: 2, group: state.group, generation, checkpoint, clock: state.clock, journeys: state.journeys});
export function initialGeneration(state) {
  return wrap(validateState(state, state.group), 0, zero);
}
export function validateGenerationState(input, group) {
  if (!input || Object.keys(input).sort().join(',') !== 'checkpoint,clock,format,generation,group,journeys'
      || input.format !== 2 || !Number.isSafeInteger(input.generation) || input.generation < 0
      || input.generation >= Number.MAX_SAFE_INTEGER || !hex.test(input.checkpoint)
      || (input.generation === 0) !== (input.checkpoint === zero)) throw fail();
  return wrap(validateState(legacy(input), group), input.generation, input.checkpoint);
}
export function mergeGenerationStates(left, right) {
  const a = validateGenerationState(left, left.group), b = validateGenerationState(right, a.group);
  if (a.generation !== b.generation || a.checkpoint !== b.checkpoint) throw new JourneyGenerationMismatch();
  return wrap(mergeStates(legacy(a), legacy(b)), a.generation, a.checkpoint);
}
export function changeGenerationJourney(state, actor, id, value) {
  const saved = validateGenerationState(state, state.group);
  return wrap(changeJourney(legacy(saved), actor, id, value), saved.generation, saved.checkpoint);
}
// Proposal only. The caller must preserve old state/pending edits and obtain
// explicit review before signing or installing a checkpoint based on this value.
export function checkpointSnapshot(state) {
  const saved = validateGenerationState(state, state.group);
  return validateState({...legacy(saved), journeys: saved.journeys.filter(entry => entry.value !== null)}, saved.group);
}
