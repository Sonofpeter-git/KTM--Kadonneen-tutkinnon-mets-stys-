/**
 * Which server event makes which noise, and on whose device.
 *
 * Keyed by event `type`, the same way describeEvent() and EventLog's tone()
 * are. Adding a sound to an action is one line here plus a file in
 * public/sounds/ - nothing else in the app knows a cue exists.
 *
 * The engine is not involved. A cue is a rendering of an event the server
 * already broadcasts, exactly like the log line and the board colour are.
 */

/*
 * Audiences are predicates, not an enum, because three of them are already
 * visible in the event shapes: the team that acted, the teams named in
 * `affected`, and the whole room.
 */

/** The device belonging to the team that did it. The default. */
export const ACTOR = (event, { me }) => event.playerId === me;

/** The teams on the receiving end - "Muut juo!" names them in `affected`. */
export const TARGETS = (event, { me }) => !!event.affected?.includes(me);

/**
 * Everyone - which in practice means the one device that volunteered to be the
 * room speaker, or the same sample fires on nine phones a few tens of
 * milliseconds apart and turns into slapback. No cue uses this yet; the flag
 * it reads is the piece still to be built.
 */
export const EVERYONE = (event, { isRoomSpeaker }) => isRoomSpeaker;

export const CUES = {
  DRINKS_CLEARED: {
    src: 'gulp.wav',
    audience: ACTOR,
    // The button clears the whole debt, but the protocol allows a partial
    // clear (`req_drink_cleared { amount }`). The sound is for finishing.
    when: (event) => event.remaining === 0,
    priority: 10,
  },

  /*
   * Tutkintouudistus, keyed on the reveal rather than on its effect event.
   * TOKEN_REVEALED carries every disc kind, so the other discs are matched off
   * their effect events below and this `when` keeps them out. Worth doing for
   * this one disc: opening it with nothing on the transcript emits only
   * TOKEN_UUDISTUS_NOOP, and that moment still deserves the noise.
   */
  TOKEN_REVEALED: {
    src: 'sad-trombone.wav',
    audience: ACTOR,
    when: (event) => event.kind === 'tutkintouudistus',
    priority: 20,
  },

  /** Three shots on arrival, no roll to save you. */
  CRUISE: { src: 'foghorn.wav', audience: ACTOR, priority: 25 },

  /** The 80op disc - three in a bag of 54. */
  TOKEN_OP: {
    src: 'jackpot.wav',
    audience: ACTOR,
    when: (event) => event.kind === 'op80',
    priority: 30,
  },

  /** The cap: d4 becomes d6 for the rest of the night. */
  TOKEN_LAKKI: { src: 'chime.wav', audience: ACTOR, priority: 35 },

  // Later, and this is the whole diff:
  // TOKEN_MUUT_JUO: { src: 'groan.mp3',     audience: TARGETS,  priority: 40 },
  // BORDER_BLOCKED: { src: 'buzzer.mp3',    audience: ACTOR,    priority: 15 },
  // GAME_FINISHED:  { src: 'fanfare.mp3',   audience: EVERYONE, priority: 50 },
};

/** Every distinct sample the table refers to, for preloading. */
export const CUE_SOURCES = [...new Set(Object.values(CUES).map((c) => c.src).filter(Boolean))];
