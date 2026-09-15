import { CUES, ACTOR } from './cues.js';

/**
 * Which single cue, if any, a batch of events should make.
 *
 * Pure on purpose: no DOM, no AudioContext, no clock. This is the part worth
 * testing, and it can be driven straight from real engine output the way the
 * render tests are.
 *
 * One cue per batch. A single action routinely emits several events - clearing
 * the last beer on an open turn fires DRINKS_CLEARED, TURN_CLAIMED and
 * TURN_BEGAN together - and playing all three at once is mush. Highest
 * priority wins; ties go to whichever came first, which is the order the
 * engine decided things happened in.
 *
 * @param events  the events that just arrived
 * @param ctx     { me, isRoomSpeaker } - `me` is this device's player id
 * @param table   the cue table; a seam so the tie and priority rules can be
 *                tested without inventing fake events for the real cues
 * @returns       { cue, event } or null
 */
export function selectCue(events, ctx, table = CUES) {
  let best = null;

  for (const event of events ?? []) {
    const cue = table[event?.type];
    if (!cue) continue;
    if (cue.when && !cue.when(event, ctx)) continue;
    if (!(cue.audience ?? ACTOR)(event, ctx)) continue;

    if (!best || (cue.priority ?? 0) > (best.cue.priority ?? 0)) best = { cue, event };
  }

  return best;
}
