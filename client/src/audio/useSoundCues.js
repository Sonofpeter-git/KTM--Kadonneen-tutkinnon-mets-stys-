import { useEffect } from 'react';
import { playerId } from '../net/socket.js';
import { useNewEvents } from '../net/useNewEvents.js';
import { selectCue } from './selectCue.js';
import { play, unlock } from './player.js';

/**
 * Turns the event feed into sound on this device.
 *
 * Driven by what came back from the server, not by the click - the client
 * never predicts a result anywhere else either (see useRoom.js), and a cue
 * fired optimistically would lie whenever the server rejected the action. On a
 * LAN the round trip is not audible.
 */
export function useSoundCues(feed) {
  /*
   * Unlock on any tap, anywhere.
   *
   * A cue plays on the phone of the team that acted, and that team just
   * touched their screen - so the gesture the autoplay policy wants is already
   * happening and needs no button of its own. Capture phase, and deliberately
   * not `once`: a backgrounded tab can have its context suspended, and the
   * next tap is what revives it.
   */
  useEffect(() => {
    const onGesture = () => { unlock(); };
    document.addEventListener('pointerdown', onGesture, { capture: true });
    return () => document.removeEventListener('pointerdown', onGesture, { capture: true });
  }, []);

  useNewEvents(feed, (events) => {
    // The id in localStorage is the one the server keys players by - req_join
    // sends it - so this is the actor test, with no dependency on state having
    // arrived and no ordering question between res_state_update and res_events.
    const hit = selectCue(events, { me: playerId(), isRoomSpeaker: false });
    if (hit) play(hit.cue.src);
  });
}
