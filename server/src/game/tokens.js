/**
 * The 54 cardboard discs (pahvikiekot) and what they do when turned over.
 */

import { shuffle } from './rng.js';

/* --------------------------------------------------------------- constants */

/** OP needed before graduating counts for anything. */
export const OP_TO_GRADUATE = 300;

/** Rolling this or higher costs a travel beer (matkaolut), even if you move less. */
export const TRAVEL_BEER_THRESHOLD = 4;

/** Beers to board the flight between Pietari and Ivalo. */
export const FLIGHT_COST = 3;

/** Cruise shots handed out on landing at the Teekkariristeily square. */
export const CRUISE_COST = 3;

/** Beer for the border guard when the d6 comes up short at Haaparanta-Tornio. */
export const BORDER_FAIL_COST = 1;

/** Beer assigned to a team you land on top of. */
export const PVP_COST = 1;

/** Turning a disc over: on arrival it is two beers, next turn it is one plus your move. */
export const OPEN_NOW_COST = 2;
export const OPEN_LATER_COST = 1;

/**
 * 'per-run'  - one beer per sea crossing, however many squares it spans.
 *              Matches "tulee heidan juoda yksi olut aloittaakseen matkan".
 * 'per-edge' - one beer per water square entered. Harsher; here if you want it.
 */
export const WATER_CHARGE_MODE = 'per-run';

/**
 * Tutkintouudistus - "the team must redo its largest course".
 *
 * Redoing a course means sitting the exam again, not losing the credits: the
 * team keeps the OP and drinks that disc's beers a second time.
 *
 * 'redrink'      - keep the OP, drink the disc's cost again. Correct, and the default.
 * 'lose-highest' - the highest OP disc is taken back off the team. Kept only
 *                  because the project blueprint's translation read that way.
 */
export const TUTKINTOUUDISTUS_MODE = 'redrink';

/* ------------------------------------------------------------- token pool */

/** Exactly the contents of the physical bag: 54 discs. */
export const TOKEN_POOL = Object.freeze({
  op40: 21,
  op60: 18,
  op80: 3,
  teekkarilakki: 3,
  tutkintouudistus: 5,
  muut_juo: 4,
});

export const TOKEN_COUNT = Object.values(TOKEN_POOL).reduce((a, b) => a + b, 0);

export const TOKEN_META = Object.freeze({
  op40: { label: '40 op', op: 40, drinks: 1 },
  op60: { label: '60 op', op: 60, drinks: 2 },
  op80: { label: '80 op', op: 80, drinks: 3 },
  teekkarilakki: { label: 'Teekkarilakki', op: 0, drinks: 1 },
  tutkintouudistus: { label: 'Tutkintouudistus', op: 0, drinks: 0 },
  muut_juo: { label: 'Muut juo!', op: 0, drinks: 0 },
});

/** One disc per city circle, face down, in random order. */
export function dealTokens(holder, cityIds) {
  const bag = [];
  for (const [kind, count] of Object.entries(TOKEN_POOL)) {
    for (let i = 0; i < count; i++) bag.push(kind);
  }
  if (bag.length !== cityIds.length) {
    throw new Error(
      `token pool (${bag.length}) does not match city count (${cityIds.length}); ` +
      'every city circle must hold exactly one disc',
    );
  }
  const dealt = shuffle(holder, bag);
  const board = {};
  cityIds.forEach((id, i) => {
    board[id] = { status: 'HIDDEN', kind: dealt[i] };
  });
  return board;
}

/* ----------------------------------------------------------- token effects */

/**
 * Apply a revealed disc. Mutates `state` in place - the engine only ever calls
 * this on a private draft it is about to return.
 *
 * `openCost` is the beers paid for the act of opening (2 on arrival, 1 later);
 * the disc's own drinks are charged on top of that.
 */
export function applyToken(state, player, kind, openCost) {
  const meta = TOKEN_META[kind];
  if (!meta) throw new Error(`unknown token kind: ${kind}`);

  const events = [];
  player.drinksOwed += openCost;

  switch (kind) {
    case 'op40':
    case 'op60':
    case 'op80': {
      player.op += meta.op;
      player.drinksOwed += meta.drinks;
      player.tokens.push({ kind, op: meta.op, drinks: meta.drinks });
      events.push({ type: 'TOKEN_OP', playerId: player.id, kind, op: meta.op });
      break;
    }

    case 'teekkarilakki': {
      player.drinksOwed += meta.drinks;
      player.dice = 6;
      player.tokens.push({ kind, op: 0, drinks: meta.drinks });
      events.push({ type: 'TOKEN_LAKKI', playerId: player.id });
      break;
    }

    case 'tutkintouudistus': {
      const opTokens = player.tokens.filter((t) => t.op > 0);
      if (opTokens.length === 0) {
        events.push({ type: 'TOKEN_UUDISTUS_NOOP', playerId: player.id });
        break;
      }
      const highest = opTokens.reduce((a, b) => (b.op > a.op ? b : a));

      if (TUTKINTOUUDISTUS_MODE === 'lose-highest') {
        player.tokens.splice(player.tokens.indexOf(highest), 1);
        player.op -= highest.op;
        events.push({ type: 'TOKEN_UUDISTUS_LOST', playerId: player.id, op: highest.op });
      } else {
        // Sit the biggest exam again: the credits stand, the beers do not.
        player.drinksOwed += highest.drinks;
        events.push({
          type: 'TOKEN_UUDISTUS_REDRINK', playerId: player.id,
          op: highest.op, drinks: highest.drinks,
        });
      }
      break;
    }

    case 'muut_juo': {
      const hit = [];
      for (const other of state.players) {
        if (other.id === player.id || other.role === 'SPECTATOR' || !other.guildId) continue;
        other.drinksOwed += 1;
        hit.push(other.id);
      }
      events.push({ type: 'TOKEN_MUUT_JUO', playerId: player.id, affected: hit });
      break;
    }
  }

  return events;
}
