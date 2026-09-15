import { useEffect, useRef } from 'react';

/**
 * Calls `onNew` with the events that arrived since the last time it ran.
 *
 * `feed` is a capped sliding window (LOG_LIMIT in useRoom.js), so its length
 * plateaus once a room is busy enough - tracking "how many events we've seen"
 * by count stops working the moment the window starts sliding. Tracking the
 * last-seen event object instead (its reference survives the slice/spread in
 * onEvents) and scanning backward until we hit it keeps working however long
 * the room runs, and still treats an empty feed (leave/rejoin) as
 * nothing-seen-yet.
 *
 * Every caller gets its own cursor, because each hook call has its own ref.
 * That matters: a shared cursor would mean whichever consumer ran first ate
 * the other's events, and the flash or the sound would go missing at random.
 *
 * `onNew` is held in a ref so a caller does not have to memoise it, and so it
 * always sees current props rather than the render it was created in.
 */
export function useNewEvents(feed, onNew) {
  const seenRef = useRef(null);
  const handlerRef = useRef(onNew);
  handlerRef.current = onNew;

  useEffect(() => {
    if (feed.length === 0) {
      seenRef.current = null;
      return;
    }

    const lastSeen = seenRef.current;
    const fresh = [];
    for (let i = feed.length - 1; i >= 0 && feed[i] !== lastSeen; i--) {
      fresh.push(feed[i]);
    }
    seenRef.current = feed[feed.length - 1];

    if (fresh.length === 0) return;
    fresh.reverse();              // hand them over in the order they happened
    handlerRef.current(fresh);
  }, [feed]);
}
