/**
 * Shared test scaffolding.
 *
 * Tests run against the real generated board and the real guild roster, so a
 * change to either that breaks the rules shows up here rather than at a party.
 */

import { loadBoard, buildBoard } from '../src/game/board.js';
import { loadGuilds } from '../src/game/guilds.js';
import { applyAction, createRoom, activePlayerId, findPlayer } from '../src/game/engine.js';
import { rollDie } from '../src/game/rng.js';

export const board = loadBoard();
export const guilds = loadGuilds();
export const deps = { board, guilds };

/** Apply a list of actions in order, returning the final state. */
export function run(state, actions, d = deps) {
  let current = state;
  for (const action of actions) current = applyAction(current, action, d).state;
  return current;
}

/** The Game Leader in every fixture. Hosts, never takes a guild. */
export const HOST = 'host';

/**
 * A lobby with `ids` joined and each assigned the matching guild.
 *
 * HOST joins first and so becomes the Game Leader, who referees rather than
 * plays - which is why the guild-holding players start at p1.
 */
export function lobby(ids, guildIds, seed = 'TEST') {
  let state = createRoom({ code: 'TEST', seed });
  state = applyAction(state, { type: 'JOIN', playerId: HOST, name: 'Host' }, deps).state;
  for (const id of ids) state = applyAction(state, { type: 'JOIN', playerId: id }, deps).state;
  ids.forEach((id, i) => {
    state = applyAction(state, { type: 'SET_GUILD', playerId: id, guildId: guildIds[i] }, deps).state;
  });
  return state;
}

/** A started two-guild game. Turn order is forced so tests know who is active. */
export function startedGame({
  ids = ['p1', 'p2'],
  guildIds = ['digit', 'tik'],
  seed = 'TEST',
  costMode,
} = {}) {
  let state = lobby(ids, guildIds, seed);
  if (costMode) {
    state = applyAction(
      state,
      { type: 'LEADER_OVERRIDE', playerId: HOST, op: 'SET_OPEN_COST_MODE', args: { mode: costMode } },
      deps,
    ).state;
  }
  state = applyAction(state, { type: 'START_GAME', playerId: HOST }, deps).state;

  if (activePlayerId(state) !== ids[0]) {
    state = applyAction(
      state,
      { type: 'LEADER_OVERRIDE', playerId: HOST, op: 'SET_TURN_ORDER', args: { turnOrder: ids } },
      deps,
    ).state;
    state.turnState.activeIndex = 0;
  }
  return state;
}

/**
 * Rig the generator so the next roll of a `sides`-sided die comes out as `want`.
 *
 * The engine's randomness is a single uint32 carried on the state, so a short
 * linear search finds a seed producing the desired face - about `sides` tries.
 */
export function forceRoll(state, sides, want) {
  for (let candidate = 1; candidate < 100000; candidate++) {
    if (rollDie({ rng: candidate }, sides) === want) {
      state.rng = candidate;
      return state;
    }
  }
  throw new Error(`no seed found for a ${want} on a d${sides}`);
}

/** Put a known disc on a city so a test can assert on what turning it does. */
export function placeToken(state, cityId, kind) {
  state.board.tokens[cityId] = { status: 'HIDDEN', kind };
  return state;
}

/** Clear every other disc, e.g. to test the "all discs turned" ending. */
export function revealAllExcept(state, keep = []) {
  for (const [cityId, cell] of Object.entries(state.board.tokens)) {
    if (!keep.includes(cityId)) cell.status = 'REVEALED';
  }
  return state;
}

export function player(state, id) {
  return findPlayer(state, id);
}

/** A hand-built graph, for path rules that the real map cannot isolate. */
export function tinyBoard(nodes) {
  return buildBoard({ nodes, homeCities: {} });
}

export function node(id, type, edges) {
  return { id, name: id, type, x: 50, y: 50, edges };
}
