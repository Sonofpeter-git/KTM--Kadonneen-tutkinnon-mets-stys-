/**
 * What leaves the server.
 *
 * Two things must never reach a client: the identity of a face-down disc, and
 * the RNG state. Either one turns the game into a solved problem for anyone with
 * devtools open - the first tells you where the 80op discs are, the second lets
 * you predict every roll before it happens.
 *
 * Sanitising happens here rather than at each emit site so there is exactly one
 * place to audit.
 */

export function sanitizeState(state, viewerId = null) {
  const { rng, board, ...rest } = state;

  return {
    ...rest,
    you: viewerId,
    board: {
      tokens: Object.fromEntries(
        Object.entries(board.tokens).map(([cityId, cell]) => [
          cityId,
          cell.status === 'HIDDEN'
            // deliberately no `kind` key at all - an undefined property still
            // survives some serialisers, a missing one cannot leak.
            ? { status: 'HIDDEN' }
            : { status: cell.status, kind: cell.kind },
        ]),
      ),
    },
    tokensRemaining: Object.values(board.tokens).filter((c) => c.status === 'HIDDEN').length,
    // The night's running total, so every client shows the same number without
    // each of them having to work it out.
    drinksTakenTotal: rest.players.reduce((n, p) => n + (p.drinksTaken ?? 0), 0),
  };
}

/**
 * Events are broadcast as they happen and are already written for public
 * consumption - a TOKEN_REVEALED event names a disc that is, by then, face up.
 * Kept as a named passthrough so a future private-event type has an obvious home.
 */
export function sanitizeEvents(events) {
  return events;
}
