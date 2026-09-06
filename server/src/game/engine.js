/**
 * The rules of Kadonneen Tutkinnon Metsastys, as a pure reducer.
 *
 *   applyAction(state, action, deps) -> { state, events }
 *
 * Nothing in here touches Redis, sockets, the clock or Math.random. The input
 * state is never mutated; a draft is cloned, mutated, and returned. That makes
 * every rule directly testable, lets the server persist state between actions
 * without ceremony, and leaves the door open to reusing the same reducer on the
 * client for optimistic prediction later.
 */

import { findDestinations, serializeDestinations } from './board.js';
import { rollDie, shuffle, seedFrom } from './rng.js';
import { computeTurnOrder, guildIndex } from './guilds.js';
import * as T from './tokens.js';

export const PHASES = {
  // Nobody may act: every team still owes drinks. Whoever finishes first plays.
  AWAITING_DRINKS: 'AWAITING_DRINKS',
  ROLLING: 'ROLLING',
  MOVING: 'MOVING',
  RESOLUTION: 'RESOLUTION',
  BORDER_ROLL: 'BORDER_ROLL',
  FINISHED: 'FINISHED',
};

const LOG_LIMIT = 120;

export class GameError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = 'GameError';
    this.code = code;
  }
}

/* ------------------------------------------------------------ construction */

export function createRoom({ code, seed = code, createdAt = 0 }) {
  return {
    code,
    status: 'LOBBY',
    rng: seedFrom(String(seed)),
    createdAt,
    players: [],
    turnOrder: [],
    turnState: null,
    board: { tokens: {} },
    winnerId: null,
    standings: [],
    log: [],
  };
}

/* -------------------------------------------------------------- accessors */

export const activePlayerId = (state) => {
  if (!state.turnState) return null;
  // While the turn is open nobody holds it, so no action may claim to be theirs.
  if (state.turnState.phase === PHASES.AWAITING_DRINKS) return null;
  return state.turnOrder[state.turnState.activeIndex] ?? null;
};

export const findPlayer = (state, id) => state.players.find((p) => p.id === id) ?? null;

/** Players actually in the race: they picked a guild and are not spectating. */
export const contenders = (state) =>
  state.players.filter((p) => p.guildId && p.role !== 'SPECTATOR');

const hiddenTokensLeft = (state) =>
  Object.values(state.board.tokens).filter((t) => t.status === 'HIDDEN').length;

/* ---------------------------------------------------------------- reducer */

export function applyAction(state, action, deps) {
  const draft = structuredClone(state);
  const events = [];
  const emit = (...list) => events.push(...list.flat());

  switch (action.type) {
    case 'JOIN': emit(join(draft, action)); break;
    case 'DISCONNECT': emit(setConnected(draft, action.playerId, false)); break;
    case 'SET_GUILD': emit(setGuild(draft, action, deps)); break;
    case 'START_GAME': emit(startGame(draft, action, deps)); break;
    case 'CLEAR_DRINKS': emit(clearDrinks(draft, action, deps)); break;
    case 'ROLL': emit(roll(draft, action, deps)); break;
    case 'MOVE': emit(move(draft, action, deps)); break;
    case 'USE_FLIGHT': emit(useFlight(draft, action, deps)); break;
    case 'OPEN_TOKEN': emit(openStandingToken(draft, action, deps)); break;
    case 'RESOLVE': emit(resolve(draft, action, deps)); break;
    case 'BORDER_ROLL': emit(borderRoll(draft, action, deps)); break;
    case 'LEADER_OVERRIDE': emit(leaderOverride(draft, action, deps)); break;
    default: throw new GameError('UNKNOWN_ACTION', `unknown action ${action.type}`);
  }

  draft.log = [...draft.log, ...events].slice(-LOG_LIMIT);
  return { state: draft, events };
}

/* ------------------------------------------------------------------ lobby */

function join(state, { playerId, name }) {
  const existing = findPlayer(state, playerId);
  if (existing) {
    existing.connected = true;
    if (name) existing.name = name;
    return [{ type: 'PLAYER_RECONNECTED', playerId }];
  }

  // Once the game is running, latecomers can only watch.
  const role = state.status !== 'LOBBY'
    ? 'SPECTATOR'
    : state.players.some((p) => p.role === 'LEADER') ? 'GAMER' : 'LEADER';

  state.players.push({
    id: playerId,
    name: name || 'Nimeton',
    guildId: null,
    homeCity: null,
    role,
    connected: true,
    nodeId: null,
    op: 0,
    drinksOwed: 0,
    // Beers actually seen off, for the running tally. drinksOwed is the debt;
    // this is the receipt, and it only ever goes up.
    drinksTaken: 0,
    dice: 4,
    tokens: [],
    place: null,
  });

  return [{ type: 'PLAYER_JOINED', playerId, role }];
}

function setConnected(state, playerId, connected) {
  const player = findPlayer(state, playerId);
  if (!player) return [];
  player.connected = connected;
  return [{ type: connected ? 'PLAYER_RECONNECTED' : 'PLAYER_DISCONNECTED', playerId }];
}

function setGuild(state, { playerId, guildId }, deps) {
  requireStatus(state, 'LOBBY');
  const player = requirePlayer(state, playerId);
  const index = guildIndex(deps.guilds);

  // The Game Leader referees: they hold the overrides, read the room and settle
  // arguments. Handing them a guild as well would make every override look like
  // self-dealing, so the role is host-only.
  if (player.role === 'LEADER') {
    throw new GameError('LEADER_DOES_NOT_PLAY', 'the Game Leader hosts rather than plays');
  }

  if (guildId !== null && !index.has(guildId)) {
    throw new GameError('UNKNOWN_GUILD', `no such guild: ${guildId}`);
  }
  if (guildId && state.players.some((p) => p.id !== playerId && p.guildId === guildId)) {
    throw new GameError('GUILD_TAKEN', `${guildId} is already taken`);
  }

  player.guildId = guildId;
  player.homeCity = guildId ? index.get(guildId).homeCity : null;
  return [{ type: 'GUILD_SELECTED', playerId, guildId }];
}

function startGame(state, { playerId }, deps) {
  requireStatus(state, 'LOBBY');
  requireLeader(state, playerId);

  const playing = contenders(state);
  if (playing.length < 2) {
    throw new GameError('NOT_ENOUGH_PLAYERS', 'at least two guilds must be picked');
  }

  // Anyone who never picked a guild watches instead of blocking the start.
  for (const p of state.players) {
    if (!p.guildId && p.role !== 'LEADER') p.role = 'SPECTATOR';
  }

  for (const p of playing) {
    p.nodeId = p.homeCity;
    p.op = 0;
    p.drinksOwed = 0;
    p.drinksTaken = 0;
    p.dice = 4;
    p.tokens = [];
    p.place = null;
  }

  state.board.tokens = T.dealTokens(state, deps.board.cityIds);
  state.turnOrder = computeTurnOrder(state, playing, deps.guilds);
  state.status = 'PLAYING';
  state.turnState = { activeIndex: 0, phase: null, roll: null, validDestinations: null, pending: [] };

  const events = [{ type: 'GAME_STARTED', turnOrder: [...state.turnOrder] }];
  // Scan from the last seat so the youngest guild - index 0 - is considered first.
  events.push(...handTurnTo(state, deps, state.turnOrder.length - 1));
  return events;
}

/* ------------------------------------------------------------ turn machine */

/**
 * Hand the turn to the next team that has finished its drinks.
 *
 * Rulebook step 1: a team is not granted its roll while drinks from an earlier
 * round are outstanding. The table does not sit and wait for them, though - the
 * turn passes on, and the slow drinker simply misses it. Teams still owing are
 * skipped, in order, until a free one is found.
 *
 * If nobody is free, the turn is left open: the first team to get its beers
 * down claims it (see claimOpenTurn).
 */
function handTurnTo(state, deps, fromIndex) {
  const ts = state.turnState;
  const order = state.turnOrder;
  const events = [];

  for (let step = 1; step <= order.length; step++) {
    const index = (fromIndex + step) % order.length;
    const candidate = findPlayer(state, order[index]);

    if (candidate.drinksOwed > 0) {
      events.push({
        type: 'TURN_SKIPPED', playerId: candidate.id, drinksOwed: candidate.drinksOwed,
      });
      continue;
    }

    ts.activeIndex = index;
    events.push({ type: 'TURN_ADVANCED', playerId: candidate.id });
    events.push(...beginTurn(state, deps, candidate.id));
    return events;
  }

  // Everyone is still drinking. Leave the turn up for grabs rather than
  // deadlocking on whichever team happens to be next in the rotation.
  ts.phase = PHASES.AWAITING_DRINKS;
  ts.roll = null;
  ts.validDestinations = null;
  ts.pending = [];
  events.push({
    type: 'TURN_OPEN',
    waitingOn: order.filter((id) => findPlayer(state, id).drinksOwed > 0),
  });
  return events;
}

/** Set up the turn for a team that is known to owe nothing. */
function beginTurn(state, deps, playerId) {
  const ts = state.turnState;
  ts.roll = null;
  ts.validDestinations = null;
  ts.pending = [];

  const player = findPlayer(state, playerId);
  // A team parked at the border faces the guard before anything else.
  ts.phase = deps.board.node(player.nodeId).type === 'border'
    ? PHASES.BORDER_ROLL
    : PHASES.ROLLING;

  return [{ type: 'TURN_BEGAN', playerId, phase: ts.phase }];
}

/**
 * An open turn goes to the first team to finish its drinks.
 *
 * Called from both routes that can bring a team to zero: marking drinks done,
 * and a leader correction. Missing the second would leave the game wedged with
 * nobody able to act.
 */
function claimOpenTurn(state, player, deps) {
  if (state.turnState?.phase !== PHASES.AWAITING_DRINKS) return [];
  if (player.drinksOwed > 0) return [];

  const index = state.turnOrder.indexOf(player.id);
  if (index === -1) return [];   // spectators and the host cannot claim a turn

  state.turnState.activeIndex = index;
  return [
    { type: 'TURN_CLAIMED', playerId: player.id },
    ...beginTurn(state, deps, player.id),
  ];
}

/**
 * Drinks can be marked done by anyone at any time - "Muut juo!" hands beers to
 * teams who are nowhere near their own turn. If the turn is currently open,
 * finishing first wins it.
 */
function clearDrinks(state, { playerId, amount }, deps) {
  requireStatus(state, 'PLAYING');
  const player = requirePlayer(state, playerId);
  if (player.drinksOwed === 0) return [];

  const cleared = amount == null ? player.drinksOwed : Math.min(amount, player.drinksOwed);
  if (cleared <= 0) throw new GameError('BAD_AMOUNT', 'amount must be positive');
  player.drinksOwed -= cleared;

  // Only drinks marked done here count towards the tally. A leader override is
  // a correction to the score, not a beer anyone drank.
  player.drinksTaken = (player.drinksTaken ?? 0) + cleared;

  const events = [{
    type: 'DRINKS_CLEARED', playerId, cleared,
    remaining: player.drinksOwed, total: player.drinksTaken,
  }];

  events.push(...claimOpenTurn(state, player, deps));
  return events;
}

function roll(state, { playerId }, deps) {
  const player = requireTurn(state, playerId, PHASES.ROLLING);

  const value = rollDie(state, player.dice);
  const events = [{ type: 'ROLLED', playerId, value, dice: player.dice }];

  // Rulebook step 2: four or more costs a travel beer, whether or not the team
  // then chooses to move the full distance.
  if (value >= T.TRAVEL_BEER_THRESHOLD) {
    player.drinksOwed += 1;
    events.push({ type: 'TRAVEL_BEER', playerId, drinks: 1 });
  }

  const destinations = findDestinations(deps.board, player.nodeId, value);
  state.turnState.roll = value;
  state.turnState.validDestinations = serializeDestinations(destinations);
  state.turnState.phase = PHASES.MOVING;

  events.push({ type: 'DESTINATIONS_OFFERED', playerId, count: destinations.size });
  return events;
}

function move(state, { playerId, targetId }, deps) {
  const player = requireTurn(state, playerId, PHASES.MOVING);

  const route = state.turnState.validDestinations?.[targetId];
  if (!route) throw new GameError('ILLEGAL_MOVE', `${targetId} is not a legal destination`);

  const events = [];
  const seaCharge = T.WATER_CHARGE_MODE === 'per-edge' ? route.waterEdges : route.waterRuns;
  if (seaCharge > 0) {
    player.drinksOwed += seaCharge;
    events.push({ type: 'WATER_ROUTE', playerId, drinks: seaCharge });
  }

  player.nodeId = targetId;
  events.push({ type: 'MOVED', playerId, to: targetId, steps: route.steps, path: route.path });
  events.push(...land(state, player, deps));
  return events;
}

/**
 * Rulebook step 3: a team sitting in Pietari or Ivalo at the start of its turn
 * may take the flight for three beers. It is an alternative to rolling, not a
 * route a die roll can walk, which is why flight edges are absent from the search.
 */
function useFlight(state, { playerId, targetId }, deps) {
  const player = requireTurn(state, playerId, PHASES.ROLLING);

  const options = deps.board.flightTargets(player.nodeId);
  if (options.length === 0) throw new GameError('NO_FLIGHT', 'no flight route from here');

  const destination = targetId ?? options[0];
  if (!options.includes(destination)) {
    throw new GameError('NO_FLIGHT', `no flight route to ${destination}`);
  }

  player.drinksOwed += T.FLIGHT_COST;
  player.nodeId = destination;

  const events = [
    { type: 'FLEW', playerId, to: destination, drinks: T.FLIGHT_COST },
    ...land(state, player, deps),
  ];
  return events;
}

/**
 * Rulebook step 5: turning a disc costs one beer and your move. This is the
 * option for a team that landed on a city last turn and chose to wait.
 */
function openStandingToken(state, { playerId }, deps) {
  const player = requireTurn(state, playerId, PHASES.ROLLING);
  const cell = state.board.tokens[player.nodeId];
  if (!cell || cell.status !== 'HIDDEN') {
    throw new GameError('NO_TOKEN', 'no face-down disc on this square');
  }

  const events = revealToken(state, player, player.nodeId, T.OPEN_LATER_COST);
  events.push(...endTurn(state, deps));
  return events;
}

/** Rulebook step 3: the border guard at Haaparanta-Tornio. */
function borderRoll(state, { playerId }, deps) {
  const player = requireTurn(state, playerId, PHASES.BORDER_ROLL);

  const value = rollDie(state, 6);
  const events = [{ type: 'BORDER_ROLLED', playerId, value }];

  if (value === 6) {
    // Guard is away: the team is free to move on this same turn.
    state.turnState.phase = PHASES.ROLLING;
    events.push({ type: 'BORDER_PASSED', playerId });
    return events;
  }

  player.drinksOwed += T.BORDER_FAIL_COST;
  events.push({ type: 'BORDER_BLOCKED', playerId, drinks: T.BORDER_FAIL_COST });
  events.push(...endTurn(state, deps));
  return events;
}

/* -------------------------------------------------------------- resolution */

/** Everything that happens because of the square a team came to rest on. */
function land(state, player, deps) {
  const events = [];
  const node = deps.board.node(player.nodeId);

  // Rulebook step 3: the cruise square pours three shots on arrival.
  if (node.type === 'cruise') {
    player.drinksOwed += T.CRUISE_COST;
    events.push({ type: 'CRUISE', playerId: player.id, drinks: T.CRUISE_COST });
  }

  const pending = [];

  const cell = state.board.tokens[player.nodeId];
  if (cell && cell.status === 'HIDDEN') pending.push({ kind: 'TOKEN', cityId: player.nodeId });

  const occupants = contenders(state)
    .filter((p) => p.id !== player.id && p.nodeId === player.nodeId)
    .map((p) => p.id);
  if (occupants.length > 0) pending.push({ kind: 'PVP', targets: occupants });

  if (pending.length > 0) {
    state.turnState.pending = pending;
    state.turnState.phase = PHASES.RESOLUTION;
    events.push({ type: 'RESOLUTION_REQUIRED', playerId: player.id, pending });
    return events;
  }

  events.push(...endTurn(state, deps));
  return events;
}

function resolve(state, { playerId, choice }, deps) {
  const player = requireTurn(state, playerId, PHASES.RESOLUTION);
  const current = state.turnState.pending[0];
  if (!current) throw new GameError('NOTHING_TO_RESOLVE', 'no pending decision');

  const events = [];

  if (current.kind === 'TOKEN') {
    if (choice?.action === 'OPEN_NOW') {
      // Rulebook step 5: opening on arrival costs two beers instead of one.
      events.push(...revealToken(state, player, current.cityId, T.OPEN_NOW_COST));
    } else if (choice?.action === 'WAIT') {
      events.push({ type: 'TOKEN_DEFERRED', playerId, cityId: current.cityId });
    } else {
      throw new GameError('BAD_CHOICE', 'expected OPEN_NOW or WAIT');
    }
  } else if (current.kind === 'PVP') {
    if (choice?.action === 'ASSIGN') {
      if (!current.targets.includes(choice.targetId)) {
        throw new GameError('BAD_TARGET', 'that team is not on this square');
      }
      const victim = requirePlayer(state, choice.targetId);
      victim.drinksOwed += T.PVP_COST;
      events.push({
        type: 'PVP_ASSIGNED', playerId, targetId: victim.id, drinks: T.PVP_COST,
      });
    } else if (choice?.action === 'SKIP') {
      events.push({ type: 'PVP_SKIPPED', playerId });
    } else {
      throw new GameError('BAD_CHOICE', 'expected ASSIGN or SKIP');
    }
  }

  state.turnState.pending.shift();

  // Opening a disc can end the game outright, so re-check before continuing.
  if (state.status === 'FINISHED') return events;

  if (state.turnState.pending.length === 0) events.push(...endTurn(state, deps));
  return events;
}

function revealToken(state, player, cityId, openCost) {
  const cell = state.board.tokens[cityId];
  if (!cell || cell.status !== 'HIDDEN') {
    throw new GameError('NO_TOKEN', 'no face-down disc on this square');
  }
  cell.status = 'REVEALED';

  return [
    { type: 'TOKEN_REVEALED', playerId: player.id, cityId, kind: cell.kind, openCost },
    ...T.applyToken(state, player, cell.kind, openCost),
  ];
}

/* ------------------------------------------------------------ end of turn */

function endTurn(state, deps) {
  const player = findPlayer(state, activePlayerId(state));
  const events = [];

  const win = checkGraduation(state, player);
  if (win) {
    events.push(...win);
    return events;
  }

  events.push(...handTurnTo(state, deps, state.turnState.activeIndex));
  return events;
}

/**
 * The game ends the instant a team collects its papers at home.
 *
 * Two ways in, both from the rulebook's closing paragraph: 300 OP in hand, or -
 * if every disc on the board has already been turned - simply being first home,
 * which is worth 80 OP on the spot.
 */
function checkGraduation(state, player) {
  if (player.nodeId !== player.homeCity) return null;

  const events = [];
  const boardExhausted = hiddenTokensLeft(state) === 0;

  if (player.op >= T.OP_TO_GRADUATE) {
    events.push({ type: 'GRADUATED', playerId: player.id, op: player.op });
  } else if (boardExhausted) {
    player.op += 80;
    events.push({ type: 'GRADUATED_EXHAUSTED', playerId: player.id, bonus: 80, op: player.op });
  } else {
    return null;
  }

  finish(state, player.id);
  events.push({ type: 'GAME_FINISHED', winnerId: player.id, standings: state.standings });
  return events;
}

function finish(state, winnerId) {
  state.status = 'FINISHED';
  state.winnerId = winnerId;
  state.turnState.phase = PHASES.FINISHED;
  state.turnState.validDestinations = null;
  state.turnState.pending = [];

  // Rulebook: the winner takes first place, everyone else is ranked on the OP
  // they were holding at that exact moment.
  const rest = contenders(state)
    .filter((p) => p.id !== winnerId)
    .sort((a, b) => b.op - a.op || state.turnOrder.indexOf(a.id) - state.turnOrder.indexOf(b.id));

  const ranked = [findPlayer(state, winnerId), ...rest];
  ranked.forEach((p, i) => { p.place = i + 1; });
  state.standings = ranked.map((p) => ({
    playerId: p.id, guildId: p.guildId, op: p.op, place: p.place,
  }));
}

/* --------------------------------------------------------- leader overrides */

/**
 * The Game Leader's escape hatch. Real games go off the rails - someone knocks a
 * pawn over, a rule gets house-ruled at 2am - and the host needs to fix state
 * without restarting.
 */
function leaderOverride(state, { playerId, op, args = {} }, deps) {
  requireLeader(state, playerId);

  switch (op) {
    case 'ADJUST_OP': {
      const target = requirePlayer(state, args.playerId);
      target.op = Math.max(0, target.op + (args.delta ?? 0));
      return [{ type: 'OVERRIDE_OP', targetId: target.id, op: target.op }];
    }

    case 'ADJUST_DRINKS': {
      const target = requirePlayer(state, args.playerId);
      target.drinksOwed = Math.max(0, target.drinksOwed + (args.delta ?? 0));
      return [
        { type: 'OVERRIDE_DRINKS', targetId: target.id, drinksOwed: target.drinksOwed },
        // A correction that clears the last debt must also release the turn,
        // or the game sits open with nobody able to act.
        ...claimOpenTurn(state, target, deps),
      ];
    }

    case 'SKIP_TURN': {
      requireStatus(state, 'PLAYING');
      const skipped = activePlayerId(state);
      return [
        { type: 'OVERRIDE_SKIP', skippedId: skipped },
        ...handTurnTo(state, deps, state.turnState.activeIndex),
      ];
    }

    case 'SET_TURN_ORDER': {
      requireStatus(state, 'PLAYING');
      const order = args.turnOrder ?? [];
      const known = new Set(state.turnOrder);
      if (order.length !== known.size || !order.every((id) => known.has(id))) {
        throw new GameError('BAD_TURN_ORDER', 'must be a permutation of the current order');
      }
      const activeId = activePlayerId(state);
      state.turnOrder = [...order];
      state.turnState.activeIndex = Math.max(0, order.indexOf(activeId));
      return [{ type: 'OVERRIDE_TURN_ORDER', turnOrder: [...order] }];
    }

    case 'RANDOMIZE_GUILDS': {
      requireStatus(state, 'LOBBY');
      const index = guildIndex(deps.guilds);
      const taken = new Set(state.players.map((p) => p.guildId).filter(Boolean));
      const free = shuffle(state, deps.guilds.filter((g) => !taken.has(g.id)));
      const assigned = [];

      for (const player of state.players) {
        // The leader hosts, so they are never dealt into the randomisation.
        if (player.guildId || player.role === 'SPECTATOR' || player.role === 'LEADER') continue;
        const guild = free.pop();
        if (!guild) break;
        player.guildId = guild.id;
        player.homeCity = index.get(guild.id).homeCity;
        assigned.push({ playerId: player.id, guildId: guild.id });
      }
      return [{ type: 'OVERRIDE_GUILDS_RANDOMIZED', assigned }];
    }

    default:
      throw new GameError('UNKNOWN_OVERRIDE', `unknown override ${op}`);
  }
}

/* ------------------------------------------------------------------ guards */

function requireStatus(state, status) {
  if (state.status !== status) {
    throw new GameError('WRONG_STATUS', `room is ${state.status}, expected ${status}`);
  }
}

function requirePlayer(state, playerId) {
  const player = findPlayer(state, playerId);
  if (!player) throw new GameError('NO_SUCH_PLAYER', `unknown player ${playerId}`);
  return player;
}

function requireLeader(state, playerId) {
  const player = requirePlayer(state, playerId);
  if (player.role !== 'LEADER') throw new GameError('NOT_LEADER', 'only the Game Leader may do that');
  return player;
}

function requireTurn(state, playerId, phase) {
  requireStatus(state, 'PLAYING');
  if (playerId !== activePlayerId(state)) {
    throw new GameError('NOT_YOUR_TURN', 'it is not your turn');
  }
  if (state.turnState.phase !== phase) {
    throw new GameError(
      'WRONG_PHASE', `turn is in ${state.turnState.phase}, this action needs ${phase}`,
    );
  }
  return requirePlayer(state, playerId);
}
