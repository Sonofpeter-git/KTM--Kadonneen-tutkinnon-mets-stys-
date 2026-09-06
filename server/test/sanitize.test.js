import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeState } from '../src/game/sanitize.js';
import { startedGame, player } from './helpers.js';

test('a face-down disc gives nothing away, not even an empty key', () => {
  const state = startedGame();
  const view = sanitizeState(state, 'p1');

  for (const [cityId, cell] of Object.entries(view.board.tokens)) {
    assert.equal(cell.status, 'HIDDEN');
    assert.ok(!('kind' in cell), `${cityId} leaked its disc`);
  }

  // The blunt check: no disc name may appear anywhere in the wire payload.
  const wire = JSON.stringify(view);
  for (const kind of ['op40', 'op60', 'op80', 'teekkarilakki', 'tutkintouudistus', 'muut_juo']) {
    assert.ok(!wire.includes(kind), `${kind} appears in the broadcast`);
  }
});

test('a turned disc is public', () => {
  const state = startedGame();
  state.board.tokens.tampere = { status: 'REVEALED', kind: 'op80' };

  const view = sanitizeState(state, 'p1');
  assert.deepEqual(view.board.tokens.tampere, { status: 'REVEALED', kind: 'op80' });
});

test('the generator state never leaves the server', () => {
  const view = sanitizeState(startedGame(), 'p1');
  assert.ok(!('rng' in view), 'the rng seed would let a client predict every roll');
});

test('the view tells each client which seat is theirs, and how many discs are left', () => {
  const state = startedGame();
  assert.equal(sanitizeState(state, 'p2').you, 'p2');
  assert.equal(sanitizeState(state).you, null);
  assert.equal(sanitizeState(state, 'p1').tokensRemaining, 54);

  state.board.tokens.tampere.status = 'REVEALED';
  assert.equal(sanitizeState(state, 'p1').tokensRemaining, 53);
});

test('the view carries the running beer tally', () => {
  const state = startedGame();
  assert.equal(sanitizeState(state, 'p1').drinksTakenTotal, 0);

  player(state, 'p1').drinksTaken = 7;
  player(state, 'p2').drinksTaken = 5;
  assert.equal(sanitizeState(state, 'p1').drinksTakenTotal, 12);
});

test('public standings survive sanitising', () => {
  const state = startedGame();
  player(state, 'p1').op = 120;
  const view = sanitizeState(state, 'p2');
  assert.equal(view.players.find((p) => p.id === 'p1').op, 120);
  assert.ok(Array.isArray(view.turnOrder));
});
