import test from 'node:test';
import assert from 'node:assert/strict';

import { findDestinations, serializeDestinations, countWaterRuns } from '../src/game/board.js';
import { TOKEN_COUNT } from '../src/game/tokens.js';
import { board, guilds, tinyBoard, node } from './helpers.js';

test('board: one city circle per cardboard disc', () => {
  assert.equal(board.cityIds.length, TOKEN_COUNT);
});

test('board: every edge is bidirectional and agrees on its type', () => {
  for (const n of board.raw.nodes) {
    for (const e of n.edges) {
      const back = board.node(e.target).edges.find((x) => x.target === n.id);
      assert.ok(back, `${n.id} -> ${e.target} has no return edge`);
      assert.equal(back.type, e.type, `${n.id} <-> ${e.target} type mismatch`);
    }
  }
});

test('board: the whole map is walkable without flying', () => {
  const seen = new Set([board.raw.nodes[0].id]);
  const queue = [board.raw.nodes[0].id];
  while (queue.length) {
    for (const e of board.node(queue.shift()).edges) {
      if (e.type === 'flight' || seen.has(e.target)) continue;
      seen.add(e.target);
      queue.push(e.target);
    }
  }
  assert.equal(seen.size, board.raw.nodes.length);
});

test('board: every home city is a real city square', () => {
  for (const home of Object.keys(board.homeCities)) {
    assert.equal(board.node(home).type, 'city', `${home} is not a city`);
  }
});

test('board: the map and the guild roster agree on who lives where', () => {
  // Two files, two authors, one fact. They drift silently otherwise.
  const fromRoster = {};
  for (const g of guilds) (fromRoster[g.homeCity] ??= []).push(g.id);

  for (const [city, ids] of Object.entries(board.homeCities)) {
    assert.deepEqual(
      [...ids].sort(), (fromRoster[city] ?? []).sort(),
      `nodes.json and guilds.json disagree about ${city}`,
    );
  }
  assert.deepEqual(
    Object.keys(board.homeCities).sort(), Object.keys(fromRoster).sort(),
    'the two files list different home cities',
  );
});

test('search: moving less than the roll is allowed, so short hops are offered too', () => {
  const found = findDestinations(board, 'turku', 3);
  const steps = [...found.values()].map((d) => d.steps);
  assert.ok(steps.includes(1), 'a one-square move should be on offer');
  assert.ok(Math.max(...steps) <= 3, 'nothing beyond the roll may be offered');
  assert.ok(!found.has('turku'), 'the square you are standing on is not a destination');
});

test('search: a route may not double back through a square it already used', () => {
  const b = tinyBoard([
    node('a', 'city', [{ target: 'b', type: 'land' }]),
    node('b', 'dot', [{ target: 'a', type: 'land' }, { target: 'c', type: 'land' }]),
    node('c', 'dot', [{ target: 'b', type: 'land' }]),
  ]);
  // With a roll of 4 on a dead-end corridor, only b and c are reachable:
  // stepping back to a to burn off distance is illegal.
  const found = findDestinations(b, 'a', 4);
  assert.deepEqual([...found.keys()].sort(), ['b', 'c']);
});

test('search: a route stops dead on entering the border square', () => {
  const found = findDestinations(board, 'tornio', 4);
  assert.ok(found.has('haaparanta'), 'the border itself is reachable');

  for (const [id, d] of found) {
    const path = [d.path[0].from, ...d.path.map((s) => s.to)];
    const crossing = path.indexOf('haaparanta');
    if (crossing !== -1) {
      assert.equal(crossing, path.length - 1, `route to ${id} walks straight through the border`);
    }
  }
});

test('search: flight routes are not walkable by die roll', () => {
  assert.ok(board.flightTargets('pietari').includes('ivalo'));
  const found = findDestinations(board, 'pietari', 6);
  assert.ok(!found.has('ivalo'), 'Ivalo must cost three beers, not a lucky roll');
});

test('search: where two routes reach a square, the dry one wins', () => {
  const b = tinyBoard([
    node('start', 'city', [{ target: 'sea', type: 'water' }, { target: 'road1', type: 'land' }]),
    node('sea', 'dot', [{ target: 'start', type: 'water' }, { target: 'target', type: 'water' }]),
    node('road1', 'dot', [{ target: 'start', type: 'land' }, { target: 'road2', type: 'land' }]),
    node('road2', 'dot', [{ target: 'road1', type: 'land' }, { target: 'target', type: 'land' }]),
    node('target', 'city', [{ target: 'sea', type: 'water' }, { target: 'road2', type: 'land' }]),
  ]);

  const found = findDestinations(b, 'start', 4);
  const chosen = found.get('target');
  assert.equal(chosen.waterRuns, 0, 'the longer dry road should be preferred over the ferry');
  assert.equal(chosen.steps, 3);
});

test('water charging counts sea legs, not squares of sea', () => {
  const oneCrossing = [
    { type: 'water' }, { type: 'water' }, { type: 'water' },
  ];
  assert.equal(countWaterRuns(oneCrossing), 1, 'one ferry ride is one beer');

  const twoCrossings = [
    { type: 'water' }, { type: 'land' }, { type: 'water' },
  ];
  assert.equal(countWaterRuns(twoCrossings), 2);
  assert.equal(countWaterRuns([{ type: 'land' }]), 0);
});

test('serialised destinations carry the full square-by-square route', () => {
  const found = findDestinations(board, 'turku', 2);
  const out = serializeDestinations(found);
  for (const [id, d] of Object.entries(out)) {
    assert.equal(d.path[0], 'turku');
    assert.equal(d.path.at(-1), id);
    assert.equal(d.path.length, d.steps + 1);
  }
});
