import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadBoard } from '../../server/src/game/board.js';
import { loadGuilds } from '../../server/src/game/guilds.js';
import { applyAction, createRoom } from '../../server/src/game/engine.js';
import { sanitizeEvents } from '../../server/src/game/sanitize.js';

import { CUES, CUE_SOURCES, ACTOR, TARGETS, EVERYONE } from '../src/audio/cues.js';
import { selectCue } from '../src/audio/selectCue.js';

/*
 * The events come out of the real engine and through the real sanitiser, so
 * these fail if the server ever stops carrying `playerId` or `remaining` -
 * which is exactly what decides whose phone makes a noise.
 */

const board = loadBoard();
const guilds = loadGuilds();
const deps = { board, guilds };

const HOST = 'host';

/** A live game where `a` owes beers. */
function owing(amount = 2) {
  let s = createRoom({ code: 'SND', seed: 'UI' });
  s = applyAction(s, { type: 'JOIN', playerId: HOST, name: 'Hessu' }, deps).state;
  s = applyAction(s, { type: 'JOIN', playerId: 'a', name: 'Anna' }, deps).state;
  s = applyAction(s, { type: 'JOIN', playerId: 'b', name: 'Beto' }, deps).state;
  s = applyAction(s, { type: 'SET_GUILD', playerId: 'a', guildId: 'digit' }, deps).state;
  s = applyAction(s, { type: 'SET_GUILD', playerId: 'b', guildId: 'tik' }, deps).state;
  s = applyAction(s, { type: 'START_GAME', playerId: HOST }, deps).state;
  s.players.find((p) => p.id === 'a').drinksOwed = amount;
  return s;
}

const clear = (state, playerId, amount) =>
  sanitizeEvents(applyAction(state, { type: 'CLEAR_DRINKS', playerId, amount }, deps).events);

/* ------------------------------------------------------- the actor's phone */

test('finishing the last beer cues the gulp on the drinking team', () => {
  const events = clear(owing(2), 'a');
  const hit = selectCue(events, { me: 'a', isRoomSpeaker: false });

  assert.ok(hit, 'expected a cue for DRINKS_CLEARED');
  assert.equal(hit.cue.src, 'gulp.wav');
  assert.equal(hit.event.type, 'DRINKS_CLEARED');
});

test('nobody else hears it', () => {
  const events = clear(owing(2), 'a');

  assert.equal(selectCue(events, { me: 'b', isRoomSpeaker: false }), null, 'another team');
  assert.equal(selectCue(events, { me: HOST, isRoomSpeaker: false }), null, 'the game leader');
  // A spectator never acts, so no event ever carries their id - the TV is
  // quiet without anything anywhere checking for a role.
  assert.equal(selectCue(events, { me: 'tv', isRoomSpeaker: false }), null, 'a spectator');
});

test('a partial clear is silent - the sound is for finishing', () => {
  const events = clear(owing(3), 'a', 1);

  assert.ok(
    events.some((e) => e.type === 'DRINKS_CLEARED' && e.remaining > 0),
    'fixture should leave a beer owing',
  );
  assert.equal(selectCue(events, { me: 'a', isRoomSpeaker: false }), null);
});

test('a leader override makes no noise - it is a correction, not a beer', () => {
  const events = sanitizeEvents(applyAction(owing(2), {
    type: 'LEADER_OVERRIDE', playerId: HOST, op: 'ADJUST_DRINKS',
    args: { playerId: 'a', delta: -2 },
  }, deps).events);

  assert.equal(selectCue(events, { me: 'a', isRoomSpeaker: false }), null);
  assert.equal(selectCue(events, { me: HOST, isRoomSpeaker: false }), null);
});

/* ------------------------------------------------------------ batch rules */

test('one cue per batch, highest priority, even when several events land together', () => {
  const events = [
    { type: 'DRINKS_CLEARED', playerId: 'a', remaining: 0 },
    { type: 'TURN_CLAIMED', playerId: 'a' },
    { type: 'TURN_BEGAN', playerId: 'a' },
  ];
  const hit = selectCue(events, { me: 'a', isRoomSpeaker: false });

  assert.ok(hit);
  assert.equal(hit.event.type, 'DRINKS_CLEARED');
});

test('the loudest cue in a batch wins, and ties go to what happened first', () => {
  const table = {
    QUIET: { src: 'quiet.wav', audience: ACTOR, priority: 5 },
    LOUD: { src: 'loud.wav', audience: ACTOR, priority: 50 },
    TIED: { src: 'tied.wav', audience: ACTOR, priority: 5 },
  };
  const ctx = { me: 'a', isRoomSpeaker: false };
  const ev = (type) => ({ type, playerId: 'a' });

  assert.equal(
    selectCue([ev('QUIET'), ev('LOUD')], ctx, table).event.type, 'LOUD',
    'priority should beat arrival order',
  );
  assert.equal(
    selectCue([ev('QUIET'), ev('TIED')], ctx, table).event.type, 'QUIET',
    'equal priority should leave the earlier event in place',
  );
});

/* -------------------------------------------------------------- audiences */

test('the audiences pick out the right devices', () => {
  const muutJuo = { type: 'TOKEN_MUUT_JUO', playerId: 'a', affected: ['b', 'host'] };

  assert.equal(ACTOR(muutJuo, { me: 'a' }), true);
  assert.equal(ACTOR(muutJuo, { me: 'b' }), false);

  assert.equal(TARGETS(muutJuo, { me: 'b' }), true);
  assert.equal(TARGETS(muutJuo, { me: 'a' }), false);
  // An event with no `affected` must not throw for a cue that asks for targets.
  assert.equal(TARGETS({ type: 'ROLLED', playerId: 'a' }, { me: 'a' }), false);

  assert.equal(EVERYONE(muutJuo, { me: 'b', isRoomSpeaker: true }), true);
  assert.equal(EVERYONE(muutJuo, { me: 'b', isRoomSpeaker: false }), false);
});

/* ------------------------------------------------------------- the assets */

test('every sample the table names actually exists', () => {
  for (const src of CUE_SOURCES) {
    const path = fileURLToPath(new URL(`../public/sounds/${src}`, import.meta.url));
    assert.ok(existsSync(path), `public/sounds/${src} is missing - that cue would be silent`);
  }
});

test('importing the player builds no AudioContext', async () => {
  // The render tests pull App.jsx into bare Node. A context at module scope
  // would take all of them down; this is the guard on that.
  const player = await import('../src/audio/player.js');
  assert.equal(player.isReady(), false);
  assert.doesNotThrow(() => player.play('gulp.wav'));
});
