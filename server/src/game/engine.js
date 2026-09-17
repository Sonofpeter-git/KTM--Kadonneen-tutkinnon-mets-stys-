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

export function createRoom({
  code, seed = code, createdAt = 0, costMode = 'full', drinkUnit = 'beer',
}) {
  return {
    code,
    status: 'LOBBY',
    rng: seedFrom(String(seed)),
    createdAt,
    costMode,
    drinkUnit,
    // Eggs found this game. Kept on the room, not just broadcast as events,
    // because the client feed is a capped window - a find made early would
    // scroll away before anyone reached the endgame card that lists it.
    eggsFound: [],
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
    case 'CLAIM_EGG': emit(claimEgg(draft, action)); break;
    default: throw new GameError('UNKNOWN_ACTION', `unknown action ${action.type}`);
  }

  emit(trackAssigned(state, draft, action, events));
  const kept = recordEggs(draft, events);
  draft.log = [...draft.log, ...kept].slice(-LOG_LIMIT);
  return { state: draft, events: kept };
}

/**
 * Drinks piled on one team between two of its own turns before it earns an egg.
 * Reached in about 16% of simulated games (200 games, 8 teams); 8 was 1%.
 */
const EGG_PILED_ON = 7;

/**
 * A water break is suggested when a team is handed this many drinks inside the
 * window. From the same simulation, ~2% of two-round stretches reach 8, which at
 * ~40s a turn is about four nudges across an 8-team game - rare enough to be
 * read rather than dismissed. Tune here if real games feel different.
 */
export const PACE_LIMIT = 8;
export const PACE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Drinks the game hands out, as opposed to drinks marked done.
 *
 * Measured on assignment because marking is batched: one hold clears everything
 * owed, so press times say nothing about how fast anyone drank. Clearing and
 * leader corrections are not the game handing anything out.
 *
 * The pace check needs `action.at`, which only the socket layer stamps - tests
 * and the simulator have no clock, and this reducer never reads one.
 */
function trackAssigned(before, draft, action, events) {
  const handsOut = action.type !== 'CLEAR_DRINKS' && action.type !== 'LEADER_OVERRIDE';
  const out = [];

  for (const p of handsOut ? draft.players : []) {
    const added = p.drinksOwed - (findPlayer(before, p.id)?.drinksOwed ?? 0);
    if (added <= 0) continue;

    p.roundLoad = (p.roundLoad ?? 0) + added;
    if (p.roundLoad >= EGG_PILED_ON) {
      out.push({ type: 'EGG_FOUND', playerId: p.id, egg: 'kaikki_paalle' });
    }

    if (action.at == null) continue;
    p.recentDrinks = [...(p.recentDrinks ?? []), { at: action.at, n: added }]
      .filter((d) => action.at - d.at < PACE_WINDOW_MS);
    const inWindow = p.recentDrinks.reduce((n, d) => n + d.n, 0);
    // Once per window per team, or a bad stretch would nag on every action.
    if (inWindow >= PACE_LIMIT && !(p.paceWarnedAt > action.at - PACE_WINDOW_MS)) {
      p.paceWarnedAt = action.at;
      out.push({
        type: 'PACE_WARNING', playerId: p.id, drinks: inWindow, minutes: PACE_WINDOW_MS / 60000,
      });
    }
  }

  // After the tally, so a round's load runs from one turn start to the next.
  for (const e of events) {
    if (e.type === 'TURN_BEGAN') findPlayer(draft, e.playerId).roundLoad = 0;
  }
  return out;
}

/**
 * File every EGG_FOUND onto the room, and drop the ones already found.
 *
 * Every egg passes through here, so no hook site has to remember whether it
 * has fired before - they can all emit unconditionally whenever their
 * condition reads true, which is the only reason the conditions stay one-liners.
 */
function recordEggs(state, events) {
  if (!events.some((e) => e.type === 'EGG_FOUND')) return events;
  state.eggsFound ??= [];   // rooms persisted before eggs existed

  return events.filter((event) => {
    if (event.type !== 'EGG_FOUND') return true;
    if (state.eggsFound.some((f) => f.egg === event.egg)) return false;
    state.eggsFound.push({ egg: event.egg, playerId: event.playerId });
    return true;
  });
}

/**
 * Eggs only a client can see: a room theme (the server has never heard of
 * them), a hold abandoned on one phone, and a cap worn out of season by that
 * phone's clock. Taken on trust - it is a party game - but only from this list,
 * so no client can award itself an egg the server judges.
 *
 * Claiming files them through recordEggs like any other, which is what puts
 * them in the feed and on the endgame card, and makes a repeat claim a no-op.
 */
const CLIENT_EGGS = new Set(['huonekoodi', 'et_uskalla', 'lakkikausi']);

function claimEgg(state, { playerId, egg }) {
  requirePlayer(state, playerId);
  if (!CLIENT_EGGS.has(egg)) throw new GameError('BAD_EGG', `${egg} cannot be claimed`);
  if (egg !== 'lakkikausi') return [{ type: 'EGG_FOUND', playerId, egg }];

  // Credited to whoever wears the cap, not to whichever phone noticed first.
  const wearer = state.players.find((p) => p.tokens?.some((t) => t.kind === 'teekkarilakki'));
  if (!wearer) throw new GameError('BAD_EGG', 'nobody is wearing a cap');
  return [{ type: 'EGG_FOUND', playerId: wearer.id, egg }];
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
    borderFails: 0,
    pokka: false,
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
    p.borderFails = 0;
    p.pokka = false;
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

  const events = revealToken(state, player, player.nodeId, openCosts(state).later);
  events.push(...endTurn(state, deps));
  return events;
}

/** Failed guard rolls before he starts greeting you personally. */
const EGG_BORDER_FAILS = 4;

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
  player.borderFails = (player.borderFails ?? 0) + 1;
  events.push({ type: 'BORDER_BLOCKED', playerId, drinks: T.BORDER_FAIL_COST });

  if (player.borderFails === EGG_BORDER_FAILS) {
    events.push({ type: 'EGG_FOUND', playerId, egg: 'rajavartija' });
  }

  events.push(...endTurn(state, deps));
  return events;
}

/* -------------------------------------------------------------- resolution */

/** Where an olutpokka is picked up. Landing only: a route through does not shop. */
const POKKA_SQUARES = ['tallinna', 'haaparanta'];

/** Everything that happens because of the square a team came to rest on. */
function land(state, player, deps) {
  const events = [];
  const node = deps.board.node(player.nodeId);

  // A booze run: stopping in Tallinn or at the Haaparanta border brings home a
  // beer crate, carried for the rest of the game. A mark, not a rule - it
  // changes nothing but how the team looks.
  if (POKKA_SQUARES.includes(node.id) && !player.pokka) {
    player.pokka = true;
    events.push({ type: 'POKKA_GAINED', playerId: player.id, at: node.id });
  }

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
      // Rulebook step 5: opening on arrival costs two beers instead of one
      // (halved in 'half' cost mode - see the Game Leader's lobby toggle).
      events.push(...revealToken(state, player, current.cityId, openCosts(state).now));
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

// `costMode` is undefined on rooms persisted before this field existed.
const openCosts = (state) => T.OPEN_COST_MODES[state.costMode ?? 'full'];

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

/** Finishing here means the last disc you needed was the one you never turned. */
const EGG_ONE_DISC_SHORT = 280;

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
    if (player.op === T.OP_TO_GRADUATE) {
      events.push({ type: 'EGG_FOUND', playerId: player.id, egg: 'tasan_300' });
    }
  } else if (boardExhausted) {
    player.op += 80;
    events.push({ type: 'GRADUATED_EXHAUSTED', playerId: player.id, bonus: 80, op: player.op });
  } else {
    return null;
  }

  finish(state, player.id);
  events.push(...endgameEggs(state, player));
  events.push({ type: 'GAME_FINISHED', winnerId: player.id, standings: state.standings });
  return events;
}

/** Eggs that can only be judged once every team's final score is in. */
function endgameEggs(state, winner) {
  const events = [];
  const rivals = contenders(state).filter((p) => p.id !== winner.id);

  // Winning on the lowest tab in the room. Needs rivals to be lower than, so a
  // one-team game cannot claim it.
  // Owed counts too: the winning turn's own beers are still on the tab when the
  // game ends, and leaving them unmarked must not make anyone look sober.
  const drunk = (p) => (p.drinksTaken ?? 0) + (p.drinksOwed ?? 0);
  if (rivals.length > 0 && rivals.every((p) => drunk(p) > drunk(winner))) {
    events.push({ type: 'EGG_FOUND', playerId: winner.id, egg: 'raitis_voittaja' });
  }

  // One disc short, for somebody who did not win.
  const soClose = rivals.find((p) => p.op === EGG_ONE_DISC_SHORT);
  if (soClose) {
    events.push({ type: 'EGG_FOUND', playerId: soClose.id, egg: 'yksi_vajaa' });
  }

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

    case 'SET_OPEN_COST_MODE': {
      // Set once from the lobby: the price of a disc shouldn't shift mid-game.
      requireStatus(state, 'LOBBY');
      if (!T.OPEN_COST_MODES[args.mode]) {
        throw new GameError('BAD_COST_MODE', 'mode must be "full" or "half"');
      }
      state.costMode = args.mode;
      return [{ type: 'OVERRIDE_COST_MODE', mode: args.mode }];
    }

    case 'SET_DRINK_UNIT': {
      // Lobby-only for the same reason as the cost mode: the unit the whole
      // table is counting in should not move once anyone has started counting.
      requireStatus(state, 'LOBBY');
      if (!T.DRINK_UNITS.includes(args.unit)) {
        throw new GameError('BAD_DRINK_UNIT', 'unit must be "beer" or "sip"');
      }
      state.drinkUnit = args.unit;
      return [{ type: 'OVERRIDE_DRINK_UNIT', unit: args.unit }];
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
