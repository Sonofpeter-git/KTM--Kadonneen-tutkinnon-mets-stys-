import test from 'node:test';
import assert from 'node:assert/strict';

import { computeTurnOrder, guildIndex } from '../src/game/guilds.js';
import { guilds } from './helpers.js';

const seats = (...guildIds) => guildIds.map((g, i) => ({ id: `p${i}`, guildId: g }));

test('roster: eight guilds, each with a real home city, no duplicate ids', () => {
  assert.equal(guilds.length, 8);
  assert.equal(new Set(guilds.map((g) => g.id)).size, 8);
  for (const g of guilds) {
    assert.ok(g.homeCity, `${g.id} has no home city`);
    assert.ok(Number.isInteger(g.foundedYear), `${g.id} has no founding year`);
    assert.equal(g.verified, true, `${g.id} is still unverified`);
  }
});

test('turn order: the real roster runs Algo first and Cluster last', () => {
  const seatFor = new Map(guilds.map((g, i) => [g.id, `p${i}`]));
  const order = computeTurnOrder({ rng: 3 }, seats(...guilds.map((g) => g.id)), guilds)
    .map((seat) => [...seatFor].find(([, s]) => s === seat)[0]);

  // 2020, then the two 1999 guilds in either order, then 1990 down to 1984.
  assert.equal(order[0], 'algo');
  assert.deepEqual(new Set(order.slice(1, 3)), new Set(['digit', 'date']));
  assert.deepEqual(order.slice(3), ['tite', 'tutti', 'otit', 'tik', 'cluster']);
});

test('roster: Digit and DaTe are both Turku guilds, as the rulebook has it', () => {
  const index = guildIndex(guilds);
  assert.equal(index.get('digit').homeCity, 'turku');
  assert.equal(index.get('date').homeCity, 'turku');
});

test('turn order: the youngest guild goes first', () => {
  const roster = [
    { id: 'old', name: 'Old', homeCity: 'turku', foundedYear: 1950 },
    { id: 'mid', name: 'Mid', homeCity: 'oulu', foundedYear: 1987 },
    { id: 'new', name: 'New', homeCity: 'vaasa', foundedYear: 2010 },
  ];
  const order = computeTurnOrder({ rng: 1 }, seats('old', 'mid', 'new'), roster);
  assert.deepEqual(order, ['p2', 'p1', 'p0']);
});

test('turn order: guilds sharing a founding year are separated by a coin flip', () => {
  const roster = [
    { id: 'a', name: 'A', homeCity: 'turku', foundedYear: 1999 },
    { id: 'b', name: 'B', homeCity: 'turku', foundedYear: 1999 },
  ];

  const outcomes = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    outcomes.add(computeTurnOrder({ rng: seed }, seats('a', 'b'), roster).join(','));
  }
  assert.equal(outcomes.size, 2, 'both orderings must be possible');
});

test('turn order: guilds with no recorded year sort last, in roster order', () => {
  const roster = [
    { id: 'unknown1', name: 'U1', homeCity: 'oulu', foundedYear: null },
    { id: 'known', name: 'K', homeCity: 'turku', foundedYear: 1975 },
    { id: 'unknown2', name: 'U2', homeCity: 'vaasa', foundedYear: null },
  ];
  const order = computeTurnOrder({ rng: 1 }, seats('unknown1', 'known', 'unknown2'), roster);
  assert.deepEqual(order, ['p1', 'p0', 'p2']);
});

test('turn order: covers every seat exactly once', () => {
  const ids = guilds.map((g) => g.id);
  const order = computeTurnOrder({ rng: 7 }, seats(...ids), guilds);
  assert.equal(order.length, ids.length);
  assert.equal(new Set(order).size, ids.length);
});
