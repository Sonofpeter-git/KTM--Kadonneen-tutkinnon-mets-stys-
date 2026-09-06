#!/usr/bin/env node
/**
 * Plays complete games headlessly and checks the rules never break.
 *
 * Unit tests pin down individual rules; this catches what only shows up over a
 * few thousand turns - a phase the machine can enter but never leave, a disc
 * that gets counted twice, a game that simply never ends.
 *
 *   npm run sim              four games, fixed seeds
 *   npm run sim -- 20        twenty games
 *   npm run sim -- 20 --log  and narrate the first one
 */

import { loadBoard } from '../src/game/board.js';
import { loadGuilds } from '../src/game/guilds.js';
import { applyAction, createRoom, activePlayerId, findPlayer, PHASES } from '../src/game/engine.js';
import { TOKEN_COUNT } from '../src/game/tokens.js';
import { nextFloat, nextInt, seedFrom } from '../src/game/rng.js';

const board = loadBoard();
const guilds = loadGuilds();
const deps = { board, guilds };

const GAMES = Number(process.argv[2]) || 4;
const NARRATE = process.argv.includes('--log');
const ACTION_CAP = 40000;

/* ------------------------------------------------------- board distances */

/** Squares from every node to `goal`, walking land and water but never flying. */
function distancesTo(goal) {
  const dist = new Map([[goal, 0]]);
  const queue = [goal];
  while (queue.length) {
    const id = queue.shift();
    for (const edge of board.node(id).edges) {
      if (edge.type === 'flight' || dist.has(edge.target)) continue;
      dist.set(edge.target, dist.get(id) + 1);
      queue.push(edge.target);
    }
  }
  return dist;
}

const homeDistances = new Map(
  Object.keys(board.homeCities).map((city) => [city, distancesTo(city)]),
);

/* ------------------------------------------------------------------- bot */

/**
 * A plausible player: collect discs until 300 op, then run for home. Good
 * enough to drive games to a natural finish rather than wandering forever.
 */
function chooseAction(state, rng) {
  const { phase } = state.turnState;

  // Nobody holds the turn: whoever has the least left to drink gets there first.
  if (phase === PHASES.AWAITING_DRINKS) {
    const racing = state.turnOrder
      .map((id) => findPlayer(state, id))
      .filter((p) => p.drinksOwed > 0)
      .sort((a, b) => a.drinksOwed - b.drinksOwed);
    if (racing.length === 0) throw new Error('turn is open but nobody owes drinks');
    return { type: 'CLEAR_DRINKS', playerId: racing[0].id };
  }

  const playerId = activePlayerId(state);
  const player = findPlayer(state, playerId);

  if (phase === PHASES.BORDER_ROLL) return { type: 'BORDER_ROLL', playerId };

  if (phase === PHASES.ROLLING) {
    const here = state.board.tokens[player.nodeId];
    // A disc under your feet is worth the whole turn - unless you are on the
    // final run home, when tempo matters more.
    if (here?.status === 'HIDDEN' && player.op < 300) return { type: 'OPEN_TOKEN', playerId };
    if (board.flightTargets(player.nodeId).length > 0 && nextFloat(rng) < 0.15) {
      return { type: 'USE_FLIGHT', playerId };
    }
    return { type: 'ROLL', playerId };
  }

  if (phase === PHASES.MOVING) {
    return { type: 'MOVE', playerId, targetId: chooseDestination(state, player, rng) };
  }

  if (phase === PHASES.RESOLUTION) {
    const pending = state.turnState.pending[0];
    if (pending.kind === 'TOKEN') {
      // Two beers now versus one beer and a whole turn later.
      return {
        type: 'RESOLVE', playerId,
        choice: { action: nextFloat(rng) < 0.7 ? 'OPEN_NOW' : 'WAIT' },
      };
    }
    return {
      type: 'RESOLVE', playerId,
      choice: { action: 'ASSIGN', targetId: pending.targets[nextInt(rng, 0, pending.targets.length - 1)] },
    };
  }

  throw new Error(`bot has nothing to do in phase ${phase}`);
}

function chooseDestination(state, player, rng) {
  const options = Object.keys(state.turnState.validDestinations);

  if (player.op >= 300) {
    const dist = homeDistances.get(player.homeCity);
    return options.reduce((best, id) =>
      (dist.get(id) ?? Infinity) < (dist.get(best) ?? Infinity) ? id : best);
  }

  const withDiscs = options.filter((id) => state.board.tokens[id]?.status === 'HIDDEN');
  const pool = withDiscs.length > 0 && nextFloat(rng) < 0.8 ? withDiscs : options;
  return pool[nextInt(rng, 0, pool.length - 1)];
}

/* ------------------------------------------------------------ invariants */

function check(state, where) {
  const problems = [];
  const cells = Object.values(state.board.tokens);

  if (cells.length !== TOKEN_COUNT) {
    problems.push(`disc count drifted: ${cells.length} cells, expected ${TOKEN_COUNT}`);
  }
  const hidden = cells.filter((c) => c.status === 'HIDDEN').length;
  const revealed = cells.filter((c) => c.status === 'REVEALED').length;
  if (hidden + revealed !== TOKEN_COUNT) {
    problems.push(`a disc went missing: ${hidden} hidden + ${revealed} turned`);
  }

  for (const p of state.players) {
    if (p.op < 0) problems.push(`${p.id} has negative op (${p.op})`);
    if (p.drinksOwed < 0) problems.push(`${p.id} owes negative drinks (${p.drinksOwed})`);
    if ((p.drinksTaken ?? 0) < 0) problems.push(`${p.id} has drunk negative beers`);
    if (![4, 6].includes(p.dice)) problems.push(`${p.id} has a d${p.dice}`);
    if (p.nodeId && !board.byId.has(p.nodeId)) problems.push(`${p.id} is off the board at ${p.nodeId}`);
    // Only while the game runs: the 80op awarded for being first home on an
    // exhausted board is deliberately not backed by a disc.
    const sum = p.tokens.reduce((n, t) => n + t.op, 0);
    if (state.status === 'PLAYING' && sum !== p.op) {
      problems.push(`${p.id} op ${p.op} does not match discs held (${sum})`);
    }
  }

  if (state.status === 'PLAYING') {
    if (!Object.values(PHASES).includes(state.turnState.phase)) {
      problems.push(`unknown phase ${state.turnState.phase}`);
    }
    if (state.turnState.phase === PHASES.FINISHED) {
      problems.push('a live game is sitting in the FINISHED phase');
    }
    if (state.turnState.phase === PHASES.AWAITING_DRINKS) {
      // An open turn is only legitimate while somebody still owes drinks.
      const owing = state.turnOrder.filter((id) => findPlayer(state, id).drinksOwed > 0);
      if (owing.length !== state.turnOrder.length) {
        problems.push('the turn is open but somebody could be playing');
      }
    } else if (!findPlayer(state, activePlayerId(state))) {
      problems.push('no active player');
    }
  }

  if (problems.length) {
    throw new Error(`invariant broken ${where}:\n  - ${problems.join('\n  - ')}`);
  }
}

/* ------------------------------------------------------------------ game */

function playOne(seedText, narrate) {
  const rng = { rng: seedFrom(`bot:${seedText}`) };
  const ids = guilds.map((g, i) => `p${i}`);
  const HOST = 'host';

  // The first to join referees and takes no guild, so the teams join after.
  let state = createRoom({ code: 'SIM', seed: seedText });
  state = applyAction(state, { type: 'JOIN', playerId: HOST }, deps).state;
  for (const id of ids) state = applyAction(state, { type: 'JOIN', playerId: id }, deps).state;
  ids.forEach((id, i) => {
    state = applyAction(state, { type: 'SET_GUILD', playerId: id, guildId: guilds[i].id }, deps).state;
  });
  state = applyAction(state, { type: 'START_GAME', playerId: HOST }, deps).state;
  check(state, 'at kickoff');

  let actions = 0;
  let rolls = 0;
  let skips = 0;

  while (state.status === 'PLAYING') {
    if (++actions > ACTION_CAP) {
      throw new Error(`game ${seedText} did not finish within ${ACTION_CAP} actions`);
    }

    const action = chooseAction(state, rng);
    if (action.type === 'ROLL') rolls++;
    if (action.type === 'TURN_SKIPPED') skips++;

    const { state: next, events } = applyAction(state, action, deps);
    state = next;
    skips += events.filter((e) => e.type === 'TURN_SKIPPED').length;
    check(state, `after ${action.type}`);

    // A team that owes drinks now misses its turn, so a sensible player drinks
    // up rather than waiting to be skipped again. Not once the game is over,
    // though: the engine refuses actions on a finished room, and the winning
    // move can perfectly well leave somebody else still holding a beer.
    for (const p of state.status === 'PLAYING' ? state.players : []) {
      if (p.guildId && p.drinksOwed > 0 && p.id !== activePlayerId(state)) {
        state = applyAction(state, { type: 'CLEAR_DRINKS', playerId: p.id }, deps).state;
        check(state, 'after an off-turn drink');
      }
    }

    if (narrate) {
      for (const e of events) {
        if (e.type === 'TOKEN_REVEALED') console.log(`    ${e.playerId} turns ${e.kind} at ${e.cityId}`);
        if (e.type === 'GRADUATED') console.log(`    ${e.playerId} graduates with ${e.op} op`);
        if (e.type === 'GRADUATED_EXHAUSTED') console.log(`    ${e.playerId} takes the last papers (+80)`);
      }
    }
  }

  const winner = findPlayer(state, state.winnerId);
  const drinks = state.players.reduce((n, p) => n + p.drinksOwed, 0);
  const drunk = state.players.reduce((n, p) => n + (p.drinksTaken ?? 0), 0);

  return {
    seed: seedText,
    actions,
    rolls,
    skips,
    winner: winner.guildId,
    winnerOp: winner.op,
    discsTurned: Object.values(state.board.tokens).filter((c) => c.status === 'REVEALED').length,
    outstandingDrinks: drinks,
    beersDrunk: drunk,
    standings: state.standings,
  };
}

/* ------------------------------------------------------------------ main */

console.log(`Simulating ${GAMES} full games on the generated board\n`);

const results = [];
for (let i = 0; i < GAMES; i++) {
  const seed = `SIM-${i}`;
  if (NARRATE && i === 0) console.log(`  ${seed}:`);
  results.push(playOne(seed, NARRATE && i === 0));
}

const avg = (pick) => Math.round(results.reduce((n, r) => n + pick(r), 0) / results.length);

console.log('\n  seed      actions   rolls   discs   winner        op');
for (const r of results) {
  console.log(
    `  ${r.seed.padEnd(9)} ${String(r.actions).padStart(7)} ${String(r.rolls).padStart(7)} ` +
    `${String(r.discsTurned).padStart(7)}   ${r.winner.padEnd(12)} ${String(r.winnerOp).padStart(4)}`,
  );
}

console.log(
  `\n  averages: ${avg((r) => r.actions)} actions, ${avg((r) => r.rolls)} rolls, ` +
  `${avg((r) => r.discsTurned)} of ${TOKEN_COUNT} discs turned, ` +
  `${avg((r) => r.beersDrunk)} beers drunk, ${avg((r) => r.skips)} turns skipped`,
);
console.log(`  ${results.length} games finished with every invariant intact.`);
