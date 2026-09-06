import test from 'node:test';
import assert from 'node:assert/strict';

import { applyAction, createRoom, PHASES, activePlayerId, GameError } from '../src/game/engine.js';
import * as T from '../src/game/tokens.js';
import {
  deps, board, lobby, startedGame, forceRoll, placeToken, revealAllExcept, player, HOST,
} from './helpers.js';

const act = (state, action) => applyAction(state, action, deps);
const throwsCode = (fn, code) =>
  assert.throws(fn, (e) => e instanceof GameError && e.code === code, `expected ${code}`);

/* ------------------------------------------------------------------ lobby */

test('lobby: the first to arrive runs the game', () => {
  let state = createRoom({ code: 'TEST' });
  state = act(state, { type: 'JOIN', playerId: 'p1' }).state;
  state = act(state, { type: 'JOIN', playerId: 'p2' }).state;

  assert.equal(player(state, 'p1').role, 'LEADER');
  assert.equal(player(state, 'p2').role, 'GAMER');
});

test('lobby: a guild can only be claimed once', () => {
  let state = lobby(['p1', 'p2'], ['digit', 'tik']);
  throwsCode(() => act(state, { type: 'SET_GUILD', playerId: 'p2', guildId: 'digit' }), 'GUILD_TAKEN');
});

test('lobby: rejoining with the same id resumes the same seat', () => {
  let state = lobby(['p1', 'p2'], ['digit', 'tik']);
  state = act(state, { type: 'DISCONNECT', playerId: 'p2' }).state;
  assert.equal(player(state, 'p2').connected, false);

  state = act(state, { type: 'JOIN', playerId: 'p2' }).state;
  assert.equal(player(state, 'p2').connected, true);
  assert.equal(player(state, 'p2').guildId, 'tik', 'guild survives a reconnect');
  assert.equal(state.players.length, 3, 'no ghost seat created (host plus two teams)');
});

test('lobby: only the leader starts, and only with two guilds', () => {
  let state = lobby(['p1'], ['digit']);
  throwsCode(() => act(state, { type: 'START_GAME', playerId: HOST }), 'NOT_ENOUGH_PLAYERS');

  state = lobby(['p1', 'p2'], ['digit', 'tik']);
  throwsCode(() => act(state, { type: 'START_GAME', playerId: 'p2' }), 'NOT_LEADER');
});

test('lobby: the Game Leader referees and cannot take a guild', () => {
  const state = lobby(['p1', 'p2'], ['digit', 'tik']);
  assert.equal(player(state, HOST).role, 'LEADER');

  throwsCode(
    () => act(state, { type: 'SET_GUILD', playerId: HOST, guildId: 'algo' }),
    'LEADER_DOES_NOT_PLAY',
  );

  const started = startedGame();
  assert.equal(player(started, HOST).guildId, null, 'the host holds no guild');
  assert.equal(player(started, HOST).nodeId, null, 'and no pawn on the board');
  assert.ok(!started.turnOrder.includes(HOST), 'and never gets a turn');
});

test('start: teams begin at home with a d4 and a full board of face-down discs', () => {
  const state = startedGame();
  assert.equal(state.status, 'PLAYING');

  for (const id of ['p1', 'p2']) {
    const p = player(state, id);
    assert.equal(p.nodeId, p.homeCity);
    assert.equal(p.dice, 4);
    assert.equal(p.op, 0);
  }
  assert.equal(player(state, 'p1').homeCity, 'turku');

  const cells = Object.values(state.board.tokens);
  assert.equal(cells.length, T.TOKEN_COUNT);
  assert.ok(cells.every((c) => c.status === 'HIDDEN'));

  const dealt = {};
  for (const c of cells) dealt[c.kind] = (dealt[c.kind] ?? 0) + 1;
  assert.deepEqual(dealt, { ...T.TOKEN_POOL }, 'the bag must be dealt out exactly');
});

/* ------------------------------------------------------------ turn machine */

test('turn: a team still drinking is skipped, not waited for', () => {
  // p1 finishes its turn owing a beer, so the turn should pass to p2 rather
  // than stalling until p1 drinks.
  let state = startedGame();
  player(state, 'p1').drinksOwed = 3;

  const { state: next, events } = act(state, {
    type: 'LEADER_OVERRIDE', playerId: HOST, op: 'SKIP_TURN',
  });
  state = next;

  assert.equal(activePlayerId(state), 'p2', 'the table does not wait for a slow drinker');
  assert.equal(state.turnState.phase, PHASES.ROLLING);

  // Coming back round, p1 is passed over again while the debt stands.
  state = act(state, { type: 'LEADER_OVERRIDE', playerId: HOST, op: 'SKIP_TURN' }).state;
  assert.equal(activePlayerId(state), 'p2', 'p1 is skipped again, so p2 plays on');
  assert.ok(
    events.some((e) => e.type === 'TURN_SKIPPED' && e.playerId === 'p1') ||
    state.log.some((e) => e.type === 'TURN_SKIPPED' && e.playerId === 'p1'),
    'the skip is announced',
  );
});

test('turn: a skipped team plays again once its drinks are done', () => {
  let state = startedGame();
  player(state, 'p1').drinksOwed = 1;

  state = act(state, { type: 'LEADER_OVERRIDE', playerId: HOST, op: 'SKIP_TURN' }).state;
  assert.equal(activePlayerId(state), 'p2');

  state = act(state, { type: 'CLEAR_DRINKS', playerId: 'p1' }).state;
  assert.equal(activePlayerId(state), 'p2', 'drinking mid-turn does not steal the turn');

  state = act(state, { type: 'LEADER_OVERRIDE', playerId: HOST, op: 'SKIP_TURN' }).state;
  assert.equal(activePlayerId(state), 'p1', 'and now p1 is eligible again');
});

test('turn: with everyone drinking the turn is left open', () => {
  let state = startedGame();
  player(state, 'p1').drinksOwed = 2;
  player(state, 'p2').drinksOwed = 5;

  state = act(state, { type: 'LEADER_OVERRIDE', playerId: HOST, op: 'SKIP_TURN' }).state;

  assert.equal(state.turnState.phase, PHASES.AWAITING_DRINKS);
  assert.equal(activePlayerId(state), null, 'nobody holds an open turn');
  throwsCode(() => act(state, { type: 'ROLL', playerId: 'p1' }), 'NOT_YOUR_TURN');
  throwsCode(() => act(state, { type: 'ROLL', playerId: 'p2' }), 'NOT_YOUR_TURN');
});

test('turn: an open turn goes to whoever finishes drinking first', () => {
  let state = startedGame();
  player(state, 'p1').drinksOwed = 2;
  player(state, 'p2').drinksOwed = 1;
  state = act(state, { type: 'LEADER_OVERRIDE', playerId: HOST, op: 'SKIP_TURN' }).state;
  assert.equal(state.turnState.phase, PHASES.AWAITING_DRINKS);

  // p1 drinks one of two - still owing, so the turn stays open.
  state = act(state, { type: 'CLEAR_DRINKS', playerId: 'p1', amount: 1 }).state;
  assert.equal(state.turnState.phase, PHASES.AWAITING_DRINKS);

  // p2 finishes first and takes it, even though p1 is earlier in the order.
  state = act(state, { type: 'CLEAR_DRINKS', playerId: 'p2' }).state;
  assert.equal(activePlayerId(state), 'p2');
  assert.equal(state.turnState.phase, PHASES.ROLLING);
});

test('turn: a leader correction can also release an open turn', () => {
  let state = startedGame();
  player(state, 'p1').drinksOwed = 2;
  player(state, 'p2').drinksOwed = 2;
  state = act(state, { type: 'LEADER_OVERRIDE', playerId: HOST, op: 'SKIP_TURN' }).state;
  assert.equal(state.turnState.phase, PHASES.AWAITING_DRINKS);

  state = act(state, {
    type: 'LEADER_OVERRIDE', playerId: HOST, op: 'ADJUST_DRINKS',
    args: { playerId: 'p1', delta: -2 },
  }).state;

  assert.equal(activePlayerId(state), 'p1', 'the game must not stay wedged');
  assert.equal(state.turnState.phase, PHASES.ROLLING);
});

test('turn: an open turn cannot be claimed by the host or a spectator', () => {
  let state = startedGame();
  player(state, 'p1').drinksOwed = 1;
  player(state, 'p2').drinksOwed = 1;
  state = act(state, { type: 'LEADER_OVERRIDE', playerId: HOST, op: 'SKIP_TURN' }).state;

  player(state, HOST).drinksOwed = 1;
  state = act(state, { type: 'CLEAR_DRINKS', playerId: HOST }).state;
  assert.equal(state.turnState.phase, PHASES.AWAITING_DRINKS, 'the host is not in the race');
});

test('tally: beers marked done accumulate, and only those', () => {
  let state = startedGame();
  assert.equal(player(state, 'p1').drinksTaken, 0);

  player(state, 'p1').drinksOwed = 3;
  state = act(state, { type: 'CLEAR_DRINKS', playerId: 'p1', amount: 2 }).state;
  assert.equal(player(state, 'p1').drinksTaken, 2);
  assert.equal(player(state, 'p1').drinksOwed, 1);

  state = act(state, { type: 'CLEAR_DRINKS', playerId: 'p1' }).state;
  assert.equal(player(state, 'p1').drinksTaken, 3, 'the tally only goes up');

  // A leader correction is not a beer anyone drank.
  player(state, 'p1').drinksOwed = 4;
  state = act(state, {
    type: 'LEADER_OVERRIDE', playerId: HOST, op: 'ADJUST_DRINKS',
    args: { playerId: 'p1', delta: -4 },
  }).state;
  assert.equal(player(state, 'p1').drinksOwed, 0);
  assert.equal(player(state, 'p1').drinksTaken, 3, 'an override must not inflate the tally');
});

test('tally: the clearing event carries the running total', () => {
  const state = startedGame();
  player(state, 'p1').drinksOwed = 2;
  const { events } = act(state, { type: 'CLEAR_DRINKS', playerId: 'p1' });
  const cleared = events.find((e) => e.type === 'DRINKS_CLEARED');
  assert.equal(cleared.cleared, 2);
  assert.equal(cleared.total, 2);
});

test('turn: a team may mark drinks done while it is not their turn', () => {
  let state = startedGame();
  player(state, 'p2').drinksOwed = 3;

  state = act(state, { type: 'CLEAR_DRINKS', playerId: 'p2' }).state;
  assert.equal(player(state, 'p2').drinksOwed, 0);
  assert.equal(activePlayerId(state), 'p1', 'clearing drinks does not steal the turn');
});

test('turn: it is not your turn until it is', () => {
  const state = startedGame();
  throwsCode(() => act(state, { type: 'ROLL', playerId: 'p2' }), 'NOT_YOUR_TURN');
});

test('roll: four or more costs a travel beer even if the team moves less', () => {
  let state = forceRoll(startedGame(), 4, 4);
  state = act(state, { type: 'ROLL', playerId: 'p1' }).state;

  assert.equal(state.turnState.roll, 4);
  assert.equal(player(state, 'p1').drinksOwed, 1, 'matkaolut');
  assert.equal(state.turnState.phase, PHASES.MOVING);

  const oneSquare = Object.entries(state.turnState.validDestinations)
    .find(([, d]) => d.steps === 1)[0];
  state = act(state, { type: 'MOVE', playerId: 'p1', targetId: oneSquare }).state;
  assert.equal(player(state, 'p1').drinksOwed, 1, 'moving short does not refund the beer');
});

test('roll: three or less is free', () => {
  let state = forceRoll(startedGame(), 4, 3);
  state = act(state, { type: 'ROLL', playerId: 'p1' }).state;
  assert.equal(player(state, 'p1').drinksOwed, 0);
});

test('move: an unoffered square is refused', () => {
  let state = forceRoll(startedGame(), 4, 2);
  state = act(state, { type: 'ROLL', playerId: 'p1' }).state;
  throwsCode(() => act(state, { type: 'MOVE', playerId: 'p1', targetId: 'ivalo' }), 'ILLEGAL_MOVE');
});

test('move: a sea crossing costs one beer', () => {
  let state = startedGame();
  revealAllExcept(state, []);              // keep discs out of this test
  state = forceRoll(state, 4, 1);
  state = act(state, { type: 'ROLL', playerId: 'p1' }).state;

  const ferry = 'maarianhamina__turku_1';  // the first square of the Aland ferry
  assert.ok(state.turnState.validDestinations[ferry]);
  state = act(state, { type: 'MOVE', playerId: 'p1', targetId: ferry }).state;
  assert.equal(player(state, 'p1').drinksOwed, 1);
});

test('move: landing on the cruise square pours three shots', () => {
  let state = startedGame();
  revealAllExcept(state, []);
  const cruise = board.raw.cruiseNode;
  const approach = board.node(cruise).edges[0].target;

  player(state, 'p1').nodeId = approach;
  state = forceRoll(state, 4, 1);
  state = act(state, { type: 'ROLL', playerId: 'p1' }).state;
  state = act(state, { type: 'MOVE', playerId: 'p1', targetId: cruise }).state;

  // one beer to be at sea, three for the cruise
  assert.equal(player(state, 'p1').drinksOwed, T.CRUISE_COST + 1);
});

test('flight: three beers from Pietari to Ivalo, and it ends the turn', () => {
  let state = startedGame();
  revealAllExcept(state, []);
  player(state, 'p1').nodeId = 'pietari';

  state = act(state, { type: 'USE_FLIGHT', playerId: 'p1' }).state;
  assert.equal(player(state, 'p1').nodeId, 'ivalo');
  assert.equal(player(state, 'p1').drinksOwed, T.FLIGHT_COST);
  assert.equal(activePlayerId(state), 'p2');
});

test('flight: not available from an airportless square', () => {
  const state = startedGame();
  throwsCode(() => act(state, { type: 'USE_FLIGHT', playerId: 'p1' }), 'NO_FLIGHT');
});

/* ----------------------------------------------------------------- border */

test('border: a team parked at the border faces the guard instead of rolling', () => {
  let state = startedGame();
  player(state, 'p1').nodeId = 'haaparanta';
  state.turnState.phase = null;
  state = act(state, { type: 'LEADER_OVERRIDE', playerId: HOST, op: 'SET_TURN_ORDER', args: { turnOrder: ['p1', 'p2'] } }).state;
  state.turnState.activeIndex = 0;
  state.turnState.phase = PHASES.BORDER_ROLL;

  throwsCode(() => act(state, { type: 'ROLL', playerId: 'p1' }), 'WRONG_PHASE');
});

test('border: a six waves you through and you still get your move', () => {
  let state = startedGame();
  player(state, 'p1').nodeId = 'haaparanta';
  state.turnState.phase = PHASES.BORDER_ROLL;
  state = forceRoll(state, 6, 6);

  state = act(state, { type: 'BORDER_ROLL', playerId: 'p1' }).state;
  assert.equal(state.turnState.phase, PHASES.ROLLING);
  assert.equal(activePlayerId(state), 'p1', 'passing the border does not end the turn');
  assert.equal(player(state, 'p1').drinksOwed, 0);
});

test('border: anything less is a beer and the turn is over', () => {
  let state = startedGame();
  player(state, 'p1').nodeId = 'haaparanta';
  state.turnState.phase = PHASES.BORDER_ROLL;
  state = forceRoll(state, 6, 3);

  state = act(state, { type: 'BORDER_ROLL', playerId: 'p1' }).state;
  assert.equal(player(state, 'p1').drinksOwed, T.BORDER_FAIL_COST);
  assert.equal(player(state, 'p1').nodeId, 'haaparanta', 'still stuck at the border');
  assert.equal(activePlayerId(state), 'p2');
});

/* ------------------------------------------------------------------ discs */

/** Walk p1 one square onto `city`, with `kind` waiting face down on it. */
function arriveAt(state, city, kind) {
  const approach = board.node(city).edges.find((e) => e.type !== 'flight').target;
  player(state, 'p1').nodeId = approach;
  revealAllExcept(state, []);
  placeToken(state, city, kind);
  let next = forceRoll(state, 4, 1);
  next = act(next, { type: 'ROLL', playerId: 'p1' }).state;
  return act(next, { type: 'MOVE', playerId: 'p1', targetId: city }).state;
}

test('disc: arriving on a city offers the choice to turn it now or wait', () => {
  const state = arriveAt(startedGame(), 'tampere', 'op40');
  assert.equal(state.turnState.phase, PHASES.RESOLUTION);
  assert.deepEqual(state.turnState.pending[0], { kind: 'TOKEN', cityId: 'tampere' });
});

test('disc: turning it on arrival costs two beers plus the disc', () => {
  let state = arriveAt(startedGame(), 'tampere', 'op60');
  state = act(state, {
    type: 'RESOLVE', playerId: 'p1', choice: { action: 'OPEN_NOW' },
  }).state;

  const p = player(state, 'p1');
  assert.equal(p.op, 60);
  assert.equal(p.drinksOwed, T.OPEN_NOW_COST + 2, 'two to open, two for a 60op');
  assert.equal(state.board.tokens.tampere.status, 'REVEALED');
  assert.equal(activePlayerId(state), 'p2');
});

test('disc: waiting leaves it face down, to be turned next turn for one beer', () => {
  let state = arriveAt(startedGame(), 'tampere', 'op40');
  state = act(state, { type: 'RESOLVE', playerId: 'p1', choice: { action: 'WAIT' } }).state;

  assert.equal(state.board.tokens.tampere.status, 'HIDDEN');
  assert.equal(player(state, 'p1').op, 0);

  // p2 passes, then p1 spends the whole turn turning the disc
  state.turnState.activeIndex = 0;
  state.turnState.phase = PHASES.ROLLING;
  state = act(state, { type: 'OPEN_TOKEN', playerId: 'p1' }).state;

  const p = player(state, 'p1');
  assert.equal(p.op, 40);
  assert.equal(p.drinksOwed, T.OPEN_LATER_COST + 1, 'one to open, one for a 40op');
  assert.equal(activePlayerId(state), 'p2', 'opening costs the move');
});

test('disc: the Teekkarilakki upgrades the die to a d6 for good', () => {
  let state = arriveAt(startedGame(), 'tampere', 'teekkarilakki');
  state = act(state, { type: 'RESOLVE', playerId: 'p1', choice: { action: 'OPEN_NOW' } }).state;

  assert.equal(player(state, 'p1').dice, 6);
  assert.equal(player(state, 'p1').op, 0);
});

test('disc: Muut juo! hands a beer to everyone else', () => {
  let state = arriveAt(startedGame(), 'tampere', 'muut_juo');
  const before = player(state, 'p2').drinksOwed;
  state = act(state, { type: 'RESOLVE', playerId: 'p1', choice: { action: 'OPEN_NOW' } }).state;

  assert.equal(player(state, 'p2').drinksOwed, before + 1);
  assert.equal(player(state, 'p1').drinksOwed, T.OPEN_NOW_COST, 'the opener drinks only the opening cost');
});

test('disc: Tutkintouudistus makes you sit the biggest exam again', () => {
  let state = startedGame();
  const p = player(state, 'p1');
  p.op = 100;
  p.tokens = [
    { kind: 'op40', op: 40, drinks: 1 },
    { kind: 'op60', op: 60, drinks: 2 },
  ];

  state = arriveAt(state, 'tampere', 'tutkintouudistus');
  state = act(state, { type: 'RESOLVE', playerId: 'p1', choice: { action: 'OPEN_NOW' } }).state;

  const after = player(state, 'p1');
  assert.equal(after.op, 100, 'the credits stand - redoing a course is not losing it');
  assert.deepEqual(after.tokens.map((t) => t.op), [40, 60], 'and the disc stays on the table');
  // two beers to open, plus the 60op course drunk a second time
  assert.equal(after.drinksOwed, T.OPEN_NOW_COST + 2);
});

test('disc: Tutkintouudistus with nothing on the transcript costs only the opening', () => {
  let state = arriveAt(startedGame(), 'tampere', 'tutkintouudistus');
  state = act(state, { type: 'RESOLVE', playerId: 'p1', choice: { action: 'OPEN_NOW' } }).state;

  assert.equal(player(state, 'p1').op, 0);
  assert.equal(player(state, 'p1').drinksOwed, T.OPEN_NOW_COST, 'no course to redo');
});

test('disc: Tutkintouudistus redoes the biggest course, not the most recent', () => {
  let state = startedGame();
  const p = player(state, 'p1');
  p.op = 120;
  p.tokens = [
    { kind: 'op80', op: 80, drinks: 3 },
    { kind: 'op40', op: 40, drinks: 1 },
  ];

  state = arriveAt(state, 'tampere', 'tutkintouudistus');
  state = act(state, { type: 'RESOLVE', playerId: 'p1', choice: { action: 'OPEN_NOW' } }).state;

  assert.equal(player(state, 'p1').drinksOwed, T.OPEN_NOW_COST + 3, 'the 80op one, not the 40op');
});

/* ------------------------------------------------------------------- pvp */

test('pvp: landing on another team lets you hand them a beer', () => {
  let state = startedGame();
  revealAllExcept(state, []);
  const target = board.node('turku').edges.find((e) => e.type === 'land').target;
  player(state, 'p2').nodeId = target;

  state = forceRoll(state, 4, 1);
  state = act(state, { type: 'ROLL', playerId: 'p1' }).state;
  state = act(state, { type: 'MOVE', playerId: 'p1', targetId: target }).state;

  assert.equal(state.turnState.pending[0].kind, 'PVP');
  state = act(state, {
    type: 'RESOLVE', playerId: 'p1', choice: { action: 'ASSIGN', targetId: 'p2' },
  }).state;

  assert.equal(player(state, 'p2').drinksOwed, T.PVP_COST);
});

test('pvp: you may decline, and cannot target someone elsewhere', () => {
  let state = startedGame();
  revealAllExcept(state, []);
  const target = board.node('turku').edges.find((e) => e.type === 'land').target;
  player(state, 'p2').nodeId = target;

  state = forceRoll(state, 4, 1);
  state = act(state, { type: 'ROLL', playerId: 'p1' }).state;
  state = act(state, { type: 'MOVE', playerId: 'p1', targetId: target }).state;

  throwsCode(() => act(state, {
    type: 'RESOLVE', playerId: 'p1', choice: { action: 'ASSIGN', targetId: 'p1' },
  }), 'BAD_TARGET');

  state = act(state, { type: 'RESOLVE', playerId: 'p1', choice: { action: 'SKIP' } }).state;
  assert.equal(player(state, 'p2').drinksOwed, 0);
  assert.equal(activePlayerId(state), 'p2');
});

/* --------------------------------------------------------------- endgame */

test('win: home with 300 op ends the game there and then', () => {
  let state = startedGame();
  revealAllExcept(state, []);
  const p = player(state, 'p1');
  p.op = 320;
  p.nodeId = board.node('turku').edges.find((e) => e.type === 'land').target;
  player(state, 'p2').op = 180;

  state = forceRoll(state, 4, 1);
  state = act(state, { type: 'ROLL', playerId: 'p1' }).state;
  state = act(state, { type: 'MOVE', playerId: 'p1', targetId: 'turku' }).state;

  assert.equal(state.status, 'FINISHED');
  assert.equal(state.winnerId, 'p1');
  assert.deepEqual(state.standings.map((s) => s.playerId), ['p1', 'p2']);
  assert.deepEqual(state.standings.map((s) => s.place), [1, 2]);
});

test('win: coming home short of 300 is not graduating', () => {
  let state = startedGame();
  const p = player(state, 'p1');
  p.op = 299;
  p.nodeId = board.node('turku').edges.find((e) => e.type === 'land').target;
  placeToken(state, 'turku', 'op40');

  state = forceRoll(state, 4, 1);
  state = act(state, { type: 'ROLL', playerId: 'p1' }).state;
  state = act(state, { type: 'MOVE', playerId: 'p1', targetId: 'turku' }).state;

  assert.equal(state.status, 'PLAYING');
});

test('win: with every disc turned, first home takes 80 op and the game', () => {
  let state = startedGame();
  revealAllExcept(state, []);
  const p = player(state, 'p1');
  p.op = 100;
  p.nodeId = board.node('turku').edges.find((e) => e.type === 'land').target;
  player(state, 'p2').op = 250;

  state = forceRoll(state, 4, 1);
  state = act(state, { type: 'ROLL', playerId: 'p1' }).state;
  state = act(state, { type: 'MOVE', playerId: 'p1', targetId: 'turku' }).state;

  assert.equal(state.status, 'FINISHED');
  assert.equal(state.winnerId, 'p1');
  assert.equal(player(state, 'p1').op, 180, '100 plus the 80op finishing bonus');
  assert.equal(player(state, 'p2').place, 2, 'more op, but not home first');
});

test('win: the places behind first are ranked on op', () => {
  let state = startedGame({ ids: ['p1', 'p2', 'p3'], guildIds: ['digit', 'tik', 'otit'] });
  revealAllExcept(state, []);
  player(state, 'p2').op = 50;
  player(state, 'p3').op = 210;

  const p = player(state, 'p1');
  p.op = 300;
  p.nodeId = board.node('turku').edges.find((e) => e.type === 'land').target;

  state = forceRoll(state, 4, 1);
  state = act(state, { type: 'ROLL', playerId: 'p1' }).state;
  state = act(state, { type: 'MOVE', playerId: 'p1', targetId: 'turku' }).state;

  assert.deepEqual(state.standings.map((s) => s.playerId), ['p1', 'p3', 'p2']);
});

/* ------------------------------------------------------------- overrides */

test('override: the leader can fix op and drinks, and never below zero', () => {
  let state = startedGame();
  state = act(state, {
    type: 'LEADER_OVERRIDE', playerId: HOST, op: 'ADJUST_OP',
    args: { playerId: 'p2', delta: 120 },
  }).state;
  assert.equal(player(state, 'p2').op, 120);

  state = act(state, {
    type: 'LEADER_OVERRIDE', playerId: HOST, op: 'ADJUST_DRINKS',
    args: { playerId: 'p2', delta: -5 },
  }).state;
  assert.equal(player(state, 'p2').drinksOwed, 0);
});

test('override: a non-leader cannot', () => {
  const state = startedGame();
  throwsCode(() => act(state, {
    type: 'LEADER_OVERRIDE', playerId: 'p2', op: 'ADJUST_OP',
    args: { playerId: 'p2', delta: 999 },
  }), 'NOT_LEADER');
});

test('override: skipping a turn moves play on', () => {
  let state = startedGame();
  state = act(state, { type: 'LEADER_OVERRIDE', playerId: HOST, op: 'SKIP_TURN' }).state;
  assert.equal(activePlayerId(state), 'p2');
});

test('override: a bogus turn order is rejected', () => {
  const state = startedGame();
  throwsCode(() => act(state, {
    type: 'LEADER_OVERRIDE', playerId: HOST, op: 'SET_TURN_ORDER',
    args: { turnOrder: ['p1', 'nobody'] },
  }), 'BAD_TURN_ORDER');
});

test('override: randomising guilds fills only the empty seats, and skips the host', () => {
  let state = createRoom({ code: 'TEST' });
  for (const id of [HOST, 'p1', 'p2', 'p3']) {
    state = act(state, { type: 'JOIN', playerId: id }).state;
  }
  state = act(state, { type: 'SET_GUILD', playerId: 'p1', guildId: 'digit' }).state;
  state = act(state, { type: 'LEADER_OVERRIDE', playerId: HOST, op: 'RANDOMIZE_GUILDS' }).state;

  assert.equal(player(state, 'p1').guildId, 'digit', 'an existing pick is left alone');
  assert.equal(player(state, HOST).guildId, null, 'the host is not dealt in');

  const picked = ['p1', 'p2', 'p3'].map((id) => player(state, id).guildId);
  assert.ok(picked.every(Boolean), 'every player ends up with a guild');
  assert.equal(new Set(picked).size, 3, 'and no two share one');
  assert.ok(['p1', 'p2', 'p3'].every((id) => player(state, id).homeCity), 'home cities filled in');
});

/* -------------------------------------------------------------- purity */

test('the reducer never mutates the state handed to it', () => {
  const before = startedGame();
  const snapshot = JSON.stringify(before);
  applyAction(before, { type: 'ROLL', playerId: 'p1' }, deps);
  assert.equal(JSON.stringify(before), snapshot);
});

test('the same seed replays the same game', () => {
  const a = startedGame({ seed: 'REPLAY' });
  const b = startedGame({ seed: 'REPLAY' });
  assert.deepEqual(a.board.tokens, b.board.tokens);
  assert.deepEqual(
    act(a, { type: 'ROLL', playerId: activePlayerId(a) }).state.turnState.roll,
    act(b, { type: 'ROLL', playerId: activePlayerId(b) }).state.turnState.roll,
  );
});
